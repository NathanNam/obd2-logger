import Foundation
import Observation

/// Tick-driven sampler. On each tick, sequentially sends every enabled PID
/// request, parses bytes from the response, and emits a value via the
/// `onTick` callback. If a tick takes longer than the configured interval
/// (likely with > 20 PIDs at 1 Hz), the next tick starts immediately.
@MainActor
final class Sampler {

    struct LiveValue {
        let pidID: String
        let raw: String   // hex string of response bytes (after the response code prefix)
        let value: Double?
        let unit: String
        let displayName: String
        let category: PidCategory
    }

    struct TickRow {
        let timestampISO: String
        let elapsedMs: Int
        /// Formatted strings keyed by `PidDef.id`. Empty/missing PIDs map to nil.
        let values: [String: String]
    }

    private let elm: ELM327
    private let pids: [PidDef]
    private let ecus: [String: EcuDef]
    private let evaluator: FormulaEvaluator
    private let sampleRateHz: Double
    private let sessionStartMs: Int

    private var task: Task<Void, Never>?
    private var stopped = false
    private var tickCount: Int = 0

    /// Per-PID strike counter. After 3 NO_DATA responses, the PID is demoted
    /// (skipped on subsequent ticks) to keep tick rate high.
    private var strikes: [String: Int] = [:]
    private(set) var disabledPIDs: Set<String> = []

    /// Periodically un-demote silent PIDs so we can re-detect them coming
    /// back online. Critical for hybrids: in EV mode the ICE PIDs go
    /// silent and would otherwise stay demoted for the whole session,
    /// missing the 2-3 minutes the engine actually runs.
    private let rehabEveryNTicks = 30

    /// Inter-query gap. Some ELM327 firmwares (Veepeak's in particular)
    /// emit `STOPPED` if the next command arrives before the prompt for
    /// the previous one has fully settled — which on multi-frame Mode 21
    /// responses takes 5-10 ms past the last `>`. Without this gap, the
    /// adapter periodically aborts queries mid-flight and per-tick PID
    /// coverage drops to 50-70%. With it, coverage stabilises at 99%
    /// (matching the web app's pacing).
    private let interQueryGapNs: UInt64 = 20_000_000  // 20 ms

    var onValue: ((LiveValue) -> Void)?
    var onTick: ((TickRow) -> Void)?

    init(
        elm: ELM327,
        pids: [PidDef],
        ecus: [String: EcuDef],
        sampleRateHz: Double,
        sessionStartMs: Int,
        evaluator: FormulaEvaluator = FormulaEvaluator()
    ) {
        self.elm = elm
        self.pids = pids
        self.ecus = ecus
        self.sampleRateHz = sampleRateHz
        self.sessionStartMs = sessionStartMs
        self.evaluator = evaluator
    }

    func start() {
        task = Task { [weak self] in
            guard let self else { return }
            let intervalNs = UInt64(1_000_000_000.0 / self.sampleRateHz)
            while !Task.isCancelled && !self.stopped {
                let tickStart = Date()
                let row = await self.runOneTick()
                await MainActor.run {
                    self.onTick?(row)
                }
                let elapsed = Date().timeIntervalSince(tickStart)
                let remaining = max(0, (Double(intervalNs) / 1_000_000_000.0) - elapsed)
                if remaining > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000.0))
                }
            }
        }
    }

    func stop() {
        stopped = true
        task?.cancel()
        task = nil
    }

    private func runOneTick() async -> TickRow {
        tickCount += 1
        // Every N ticks, give demoted PIDs another shot. If they're still
        // silent they'll re-demote within ~3 ticks; meanwhile we capture
        // anything that has come back online (ICE waking up in a hybrid,
        // BMS becoming active under load, etc.).
        if tickCount % rehabEveryNTicks == 0, !disabledPIDs.isEmpty {
            NSLog("[Sampler] rehab tick \(tickCount): un-demoting \(disabledPIDs.count) PIDs")
            disabledPIDs.removeAll()
            strikes.removeAll()
        }

        let startMs = Int(Date().timeIntervalSince1970 * 1000)
        let elapsedMs = startMs - sessionStartMs
        let timestampISO = ISO8601DateFormatter.utcMs.string(from: Date())

        var values: [String: String] = [:]
        // Group enabled PIDs by ECU, then dedupe identical (mode, pid)
        // queries within each group. Several PidDefs can share one query
        // and read different bytes — e.g. battery_temp_1..4 all use
        // Mode 21 PID 95. Sending the query once and applying all four
        // formulas to the response is faster *and* avoids tripping
        // adapter rate limits on rapid-fire identical queries.
        // Per-group ATSH<request_header> before queries — Mode 21 PIDs
        // on non-engine ECUs only respond when explicitly addressed.
        let groups = groupByEcu(pids.filter { !disabledPIDs.contains($0.id) })
        for (ecuName, groupPIDs) in groups {
            if let ecu = ecus[ecuName] {
                _ = try? await elm.send("ATSH\(ecu.requestHeader)", timeout: 0.8)
                // Modern UDS ECUs (Hyundai-Kia 2024+ confirmed) gate Mode 22
                // live-data DIDs behind the extended diagnostic session. Mirror
                // the web sweep/sampler fix: send 10 03 once per ECU per tick
                // if any PID at this ECU uses Mode 22. Failure is ignored —
                // unsupported DIDs fall through to the existing strike logic.
                let wantsMode22 = groupPIDs.contains(where: { $0.mode == "22" })
                if wantsMode22 {
                    _ = try? await elm.send("1003", timeout: 1.2)
                }
            }
            for (mode, pid, defs) in dedupeByQuery(groupPIDs) {
                let request = mode + pid
                let response: String
                do {
                    response = try await elm.send(request, timeout: 1.0)
                } catch {
                    for def in defs { bumpStrike(def.id) }
                    try? await Task.sleep(nanoseconds: interQueryGapNs)
                    continue
                }
                // Inter-query settle gap (see `interQueryGapNs` comment).
                try? await Task.sleep(nanoseconds: interQueryGapNs)
                let normalized = response.uppercased()
                    .replacingOccurrences(of: " ", with: "")
                    .replacingOccurrences(of: "\n", with: "")
                    .replacingOccurrences(of: "\r", with: "")
                if normalized.contains("NODATA") {
                    NSLog("[Sampler] \(request) → NO DATA (defs: \(defs.map { $0.id }))")
                    for def in defs { bumpStrike(def.id) }
                    continue
                }
                // ELM emits STOPPED when a previous query was interrupted
                // by the next command arriving too fast. We've added the
                // inter-query gap above to prevent this, but log + bump
                // on the way through so accidental occurrences are visible.
                if normalized.contains("STOPPED") {
                    NSLog("[Sampler] \(request) → STOPPED (adapter overrun)")
                    for def in defs { bumpStrike(def.id) }
                    continue
                }
                guard let payload = extractPayload(response: response, mode: mode, pid: pid) else {
                    NSLog("[Sampler] \(request) → no positive prefix in \"\(normalized)\"")
                    for def in defs { bumpStrike(def.id) }
                    continue
                }
                // SAE J1979 sentinel: all-0xFF payload means "I support
                // this PID but have no data right now." Treat as missing
                // rather than decoding a literal 65535 km / 255.
                if !payload.isEmpty, payload.allSatisfy({ $0 == 0xFF }) {
                    for def in defs { bumpStrike(def.id) }
                    continue
                }
                for def in defs {
                    strikes[def.id] = 0
                    let evaluated = evaluator.evaluate(formula: def.formula, bytes: payload)
                    let formatted: String = {
                        if let v = evaluated {
                            return Sampler.format(value: v)
                        } else {
                            return HexParsing.hex(payload)
                        }
                    }()
                    values[def.id] = formatted
                    let live = LiveValue(
                        pidID: def.id,
                        raw: HexParsing.hex(payload),
                        value: evaluated,
                        unit: def.unit,
                        displayName: def.displayName,
                        category: def.category
                    )
                    onValue?(live)
                }
            }
        }
        return TickRow(timestampISO: timestampISO, elapsedMs: elapsedMs, values: values)
    }

    /// Group PIDs that share a (mode, pid) query so we issue one request
    /// per unique query instead of N copies. Preserves first-seen order.
    private func dedupeByQuery(_ pids: [PidDef]) -> [(mode: String, pid: String, defs: [PidDef])] {
        var keyOrder: [String] = []
        var byKey: [String: (String, String, [PidDef])] = [:]
        for pid in pids {
            let key = "\(pid.mode)\(pid.pid)".uppercased()
            if var existing = byKey[key] {
                existing.2.append(pid)
                byKey[key] = existing
            } else {
                byKey[key] = (pid.mode, pid.pid, [pid])
                keyOrder.append(key)
            }
        }
        return keyOrder.compactMap { byKey[$0] }
    }

    /// Stable iteration order: sort ECU names alphabetically so output is
    /// deterministic for any given profile.
    private func groupByEcu(_ pids: [PidDef]) -> [(String, [PidDef])] {
        var grouped: [String: [PidDef]] = [:]
        for pid in pids {
            grouped[pid.ecu, default: []].append(pid)
        }
        return grouped.keys.sorted().map { ($0, grouped[$0]!) }
    }

    private func bumpStrike(_ id: String) {
        let current = (strikes[id] ?? 0) + 1
        strikes[id] = current
        if current >= 3 { disabledPIDs.insert(id) }
    }

    private static func format(value v: Double) -> String {
        if v.rounded() == v && abs(v) < 1e9 {
            return String(Int(v))
        }
        let rounded = (v * 1000).rounded() / 1000
        return String(rounded)
    }

    /// Extract the payload bytes (everything after the positive response
    /// code) from an ELM327 response. Handles both single-frame responses
    /// like `61617170778000` and multi-frame ISO-TP responses where each
    /// frame is prefixed with `<digit>:` and a leading length byte appears
    /// on its own line:
    ///
    ///     011
    ///     0:61951B1A1A1A1A
    ///     1:1B1A1A1A1A1A1A1B
    ///     2:1B1B1A1B00
    ///     0000
    ///
    /// The previous implementation `HexParsing.bytes` rejected any string
    /// containing `:`, so multi-frame responses were silently dropped —
    /// every Mode 21 PID with a long payload (PID 95 battery temps, PID 98
    /// HV voltage on Lexus hybrids) ended up at 0% coverage. Splitting on
    /// newlines and searching each line for the response prefix mirrors
    /// what the web app's `decodePidResponse` does.
    private func extractPayload(response: String, mode: String, pid: String) -> [UInt8]? {
        guard let modeByte = UInt8(mode, radix: 16) else { return nil }
        let prefix = String(format: "%02X%@", modeByte + 0x40, pid.uppercased())
        let lines = response.uppercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "") }
            .filter { !$0.isEmpty }
        for line in lines {
            // Strip a leading "<digit>:" frame-index prefix if present.
            let cleaned: String
            if let colonIdx = line.firstIndex(of: ":"),
               line.distance(from: line.startIndex, to: colonIdx) <= 2,
               line[..<colonIdx].allSatisfy({ $0.isHexDigit }) {
                cleaned = String(line[line.index(after: colonIdx)...])
            } else {
                cleaned = line
            }
            if let prefixRange = cleaned.range(of: prefix) {
                let after = String(cleaned[prefixRange.upperBound...])
                return HexParsing.bytes(after)
            }
        }
        return nil
    }
}

extension ISO8601DateFormatter {
    static let utcMs: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}
