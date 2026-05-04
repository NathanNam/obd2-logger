import Foundation
import Observation

/// Top-level orchestration for a logging session: probe, open CSV, drive the
/// sampler, finalize a sessions.jsonl entry on stop.
@MainActor
@Observable
final class LoggingSession {

    enum State: Equatable {
        case idle
        case preparing(step: String)
        case logging(rowCount: Int, sessionID: String)
        case error(String)
    }

    private(set) var state: State = .idle
    private(set) var liveValues: [String: Sampler.LiveValue] = [:]
    private(set) var enabledPIDs: [PidDef] = []

    private var elm: ELM327?
    private var sampler: Sampler?
    private var writer: CSVWriter?
    private var vehicle: Vehicle?
    private var profile: Profile?
    private var sessionID: String = ""
    private var sessionStartMs: Int = 0
    private var sessionStartISO: String = ""
    private var sampleRateHz: Double = 1.0
    private var rawMode: Bool = false

    /// Smart-stop state: count consecutive ticks where every PID returned
    /// no data. After ~60s of those, the session auto-stops and is tagged
    /// `auto_stop_idle` in the manifest. Catches the common "user forgot
    /// to tap Stop after parking" case.
    private var emptyTickStreak: Int = 0
    private var autoStopAfterEmptyTicks: Int {
        // 60 seconds of empty ticks, scaled to the active sample rate.
        max(10, Int((60.0 * sampleRateHz).rounded()))
    }

    static let shared = LoggingSession()

    /// Start a new logging session. Probes profile PIDs against the live ECU
    /// (cached in the vehicle if already probed), opens a CSV file, and starts
    /// the sampler.
    func start(
        vehicle: Vehicle,
        profile: Profile,
        elm: ELM327,
        sampleRateHz: Double,
        rawMode: Bool
    ) async {
        // Allow re-entry from .error too — when the ECU liveness check
        // fails, cleanup() preserves .error so the UI can show the message,
        // and the user is expected to fix the car state (e.g. push-start
        // to READY) and tap Start logging again. Without this, the second
        // tap was a no-op and required terminating the app to recover.
        switch state {
        case .preparing, .logging:
            return
        case .idle, .error:
            break
        }
        self.elm = elm
        self.profile = profile
        self.vehicle = vehicle
        self.sampleRateHz = sampleRateHz
        self.rawMode = rawMode

        do {
            // 0. Liveness probe: ask the ECU one cheap Mode-01 query. If it
            //    times out or returns NO_DATA, the vehicle isn't in READY
            //    mode (Toyota/Lexus hybrids stay asleep until foot-on-brake
            //    push-start), so abort with a clear error before we burn
            //    time on full discovery + probe (each of which takes ~15s
            //    of timeouts when the ECU is silent).
            state = .preparing(step: "Checking vehicle…")
            if try await !ECULiveness.check(elm: elm) {
                throw LoggingSessionError.ecuNotResponding
            }

            // 1a. Discover standard Mode-01 PIDs via the supported-PIDs bitmap
            //     sweep. Trust the vehicle cache if present (skip in raw mode).
            var supportedStandard = vehicle.supportedStandardPIDs
            if rawMode {
                // In raw mode we still want a useful set; fall back to discovery
                // if the cache is empty so we have something to log.
                if supportedStandard.isEmpty {
                    state = .preparing(step: "Discovering standard PIDs…")
                    supportedStandard = (try? await StandardPIDDiscovery.discover(elm: elm)) ?? []
                }
            } else if supportedStandard.isEmpty {
                state = .preparing(step: "Discovering standard PIDs…")
                supportedStandard = (try? await StandardPIDDiscovery.discover(elm: elm)) ?? []
            }

            // 1b. Probe profile PIDs (or trust cache).
            var supportedProfile = vehicle.supportedProfilePIDs
            if rawMode {
                state = .preparing(step: "Raw mode — querying every profile PID.")
                supportedProfile = profile.pids.map { $0.id }
            } else if supportedProfile.isEmpty {
                state = .preparing(step: "Probing profile PIDs…")
                supportedProfile = try await ProfileProbe.probe(elm: elm, profile: profile)
            }

            // 1c. Build the combined registry (standard + profile PIDs).
            enabledPIDs = RegistryBuilder.build(
                profile: profile,
                supportedStandardPIDs: supportedStandard,
                supportedProfilePIDs: supportedProfile,
                disabledPIDs: vehicle.disabledPIDs
            )

            // 2. Persist updated supported sets on the vehicle (skip in raw mode).
            if !rawMode {
                var updated = vehicle
                updated.supportedStandardPIDs = supportedStandard
                updated.supportedProfilePIDs = supportedProfile
                updated.profileVersion = profile.profileVersion
                updated.lastUsedUTC = ISO8601DateFormatter.utcMs.string(from: Date())
                try VehicleStore.shared.save(updated)
                self.vehicle = updated
            }

            // 3. Open CSV.
            state = .preparing(step: "Opening CSV…")
            sessionID = SessionID.generate()
            sessionStartMs = Int(Date().timeIntervalSince1970 * 1000)
            sessionStartISO = ISO8601DateFormatter.utcMs.string(from: Date())
            let filename = (rawMode ? "raw__" : "") + SessionID.sessionFilename(
                startISO: sessionStartISO,
                sessionID: sessionID
            )
            try AppStorage.shared.ensureDir(AppPath.sessionsDir(vehicle.owner, vehicle.slug))
            let path = "\(AppPath.sessionsDir(vehicle.owner, vehicle.slug))/\(filename)"
            writer = try CSVWriter.create(
                path: path,
                columnIDs: enabledPIDs.map { $0.id },
                metadata: [
                    "session_id": sessionID,
                    "vehicle_slug": vehicle.slug,
                    "profile_id": vehicle.profileId,
                ]
            )

            // 4. Start sampler.
            let sampler = Sampler(
                elm: elm,
                pids: enabledPIDs,
                ecus: profile.ecus,
                sampleRateHz: sampleRateHz,
                sessionStartMs: sessionStartMs
            )
            sampler.onValue = { [weak self] live in
                guard let self, case .logging = self.state else { return }
                self.liveValues[live.pidID] = live
            }
            sampler.onTick = { [weak self] row in
                // The sampler dispatches onTick via `MainActor.run` at the
                // end of each tick. cleanup() also runs on MainActor, so a
                // tick already in flight when the user taps Stop ends up
                // queued *behind* cleanup. Without the state guard, that
                // late onTick clobbers `state = .idle` with a fresh
                // `.logging(...)`, the UI flips back to "Stop", and the
                // user has to tap a second time.
                guard let self, case .logging = self.state else { return }
                do {
                    try self.writer?.writeRow(
                        timestampISO: row.timestampISO,
                        elapsedMs: row.elapsedMs,
                        values: row.values
                    )
                    let count = self.writer?.rowCount ?? 0
                    self.state = .logging(rowCount: count, sessionID: self.sessionID)
                } catch {
                    // Don't crash the sampler on a transient write failure.
                }

                // Smart-stop: if the user forgot to tap Stop and the car
                // is parked / off, the sampler keeps writing empty rows.
                // After ~60 seconds of consecutive empty ticks, auto-stop
                // and tag the session as `auto_stop_idle` in the manifest.
                if row.values.isEmpty {
                    self.emptyTickStreak += 1
                    if self.emptyTickStreak >= self.autoStopAfterEmptyTicks {
                        self.emptyTickStreak = 0  // don't refire while cleanup races
                        Task { await self.stop(reason: "auto_stop_idle") }
                    }
                } else {
                    self.emptyTickStreak = 0
                }
            }
            sampler.start()
            self.sampler = sampler

            // Keep the app running in background by holding an active
            // location session — Apple's sanctioned keep-alive for trip
            // tracking apps. We don't store the location data; it's just
            // what the OS requires to keep the BLE polling loop alive.
            // See LocationKeepAlive.swift.
            LocationKeepAlive.shared.start()

            state = .logging(rowCount: 0, sessionID: sessionID)
        } catch {
            state = .error((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            await cleanup(reason: "error")
        }
    }

    /// Stop the running session, close the CSV, append a sessions.jsonl entry.
    func stop(reason: String = "user_stop") async {
        guard case .logging = state else {
            await cleanup(reason: reason)
            return
        }
        await cleanup(reason: reason)
    }

    private func cleanup(reason: String) async {
        sampler?.stop()
        LocationKeepAlive.shared.stop()
        let writerSnapshot = writer
        try? writerSnapshot?.close()

        if let vehicle, let profile, let writer = writerSnapshot {
            let endMs = Int(Date().timeIntervalSince1970 * 1000)
            let endISO = ISO8601DateFormatter.utcMs.string(from: Date())
            let filename = (rawMode ? "raw__" : "") + SessionID.sessionFilename(
                startISO: sessionStartISO,
                sessionID: sessionID
            )
            let record = SessionRecord(
                sessionID: sessionID,
                startUTC: sessionStartISO,
                endUTC: endISO,
                durationMs: endMs - sessionStartMs,
                sampleRateHz: sampleRateHz,
                rowCount: writer.rowCount,
                profileID: profile.profileId,
                profileVersion: profile.profileVersion,
                pidCount: enabledPIDs.count,
                file: "sessions/\(filename)",
                endedReason: reason,
                meanPidCompletionPct: 100.0,  // TODO: track per-PID completion in Sampler
                rawMode: rawMode
            )
            do {
                let line = try JSONEncoder().encode(record)
                if let json = String(data: line, encoding: .utf8) {
                    try AppStorage.shared.appendText(
                        json + "\n",
                        to: AppPath.sessionsManifest(vehicle.owner, vehicle.slug)
                    )
                }
            } catch {
                // Manifest append failure shouldn't abort the cleanup.
            }
        }

        sampler = nil
        writer = nil
        elm = nil
        profile = nil
        liveValues.removeAll()
        emptyTickStreak = 0
        if case .error = state {
            // keep error state so UI can show it
        } else {
            state = .idle
        }
    }
}
