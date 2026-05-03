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

    /// Per-PID strike counter. After 3 NO_DATA responses, the PID is demoted
    /// (skipped on subsequent ticks) to keep tick rate high.
    private var strikes: [String: Int] = [:]
    private(set) var disabledPIDs: Set<String> = []

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
        let startMs = Int(Date().timeIntervalSince1970 * 1000)
        let elapsedMs = startMs - sessionStartMs
        let timestampISO = ISO8601DateFormatter.utcMs.string(from: Date())

        var values: [String: String] = [:]
        // Group enabled PIDs by ECU. For each group, set ATSH<request_header>
        // once before issuing the PIDs in that group. Without this, Mode 21
        // PIDs on non-engine ECUs (hybrid_controller, transmission) get
        // delivered to the wrong ECU via the broadcast functional address
        // and silently return NO_DATA. Mirrors the web sampler's behavior
        // (`src/obd/sampler.ts` groupByEcu + ATSH before each group).
        let groups = groupByEcu(pids.filter { !disabledPIDs.contains($0.id) })
        for (ecuName, groupPIDs) in groups {
            if let ecu = ecus[ecuName] {
                _ = try? await elm.send("ATSH\(ecu.requestHeader)", timeout: 0.8)
            }
            for pid in groupPIDs {
                let request = pid.mode + pid.pid
                do {
                    let response = try await elm.send(request, timeout: 1.0)
                    let normalized = response.uppercased()
                        .replacingOccurrences(of: " ", with: "")
                        .replacingOccurrences(of: "\n", with: "")
                        .replacingOccurrences(of: "\r", with: "")
                    if normalized.contains("NODATA") {
                        bumpStrike(pid.id)
                        continue
                    }
                    guard let bytes = HexParsing.bytes(normalized) else { continue }
                    guard let payload = stripResponseCode(bytes: bytes, mode: pid.mode, pid: pid.pid) else {
                        continue
                    }
                    strikes[pid.id] = 0  // success → reset strike counter
                    let evaluated = evaluator.evaluate(formula: pid.formula, bytes: payload)
                    let formatted: String = {
                        if let v = evaluated {
                            return Sampler.format(value: v)
                        } else {
                            return HexParsing.hex(payload)
                        }
                    }()
                    values[pid.id] = formatted
                    let live = LiveValue(
                        pidID: pid.id,
                        raw: HexParsing.hex(payload),
                        value: evaluated,
                        unit: pid.unit,
                        displayName: pid.displayName
                    )
                    onValue?(live)
                } catch {
                    bumpStrike(pid.id)
                    continue
                }
            }
        }
        return TickRow(timestampISO: timestampISO, elapsedMs: elapsedMs, values: values)
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

    /// Find `4<mode><pid>` in `bytes` and return everything after.
    private func stripResponseCode(bytes: [UInt8], mode: String, pid: String) -> [UInt8]? {
        guard let modeByte = UInt8(mode, radix: 16),
              let pidByte = UInt8(pid, radix: 16) else { return nil }
        let positive = modeByte + 0x40
        for i in 0..<(bytes.count - 1) {
            if bytes[i] == positive && bytes[i + 1] == pidByte {
                return Array(bytes[(i + 2)...])
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
