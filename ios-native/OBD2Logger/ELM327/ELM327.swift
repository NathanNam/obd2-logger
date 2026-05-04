import Foundation
import Observation

/// ELM327 protocol layer over a `BLEManager`-backed transport.
///
/// Adapter quirks this handles:
///   - Responses are terminated by a `>` prompt character. We frame on that.
///   - Init sequence (ATZ → ATE0 → ATL0 → ATS0 → ATH0 → ATSP0 → ATCAF1) must
///     run sequentially with each `OK` before the next.
///   - Multiple commands queued at once must serialize — only one in-flight
///     at a time. The queue does that.
@MainActor
@Observable
final class ELM327 {

    enum Direction: String {
        case tx, rx, info, err
    }

    struct LogEntry: Identifiable {
        let id = UUID()
        let direction: Direction
        let text: String
        let timestamp: Date
    }

    private(set) var log: [LogEntry] = []
    private var lineBuffer = ""

    /// Cap log length so the UI doesn't grow unbounded over a long session.
    private let maxLogEntries = 400

    private let ble: BLEManager
    private var inboundTask: Task<Void, Never>?

    /// Single-flight gate — only one command in flight at a time.
    private var inFlight: CheckedContinuation<String, Error>?
    /// Optional timeout task tied to the in-flight command.
    private var timeoutTask: Task<Void, Never>?

    init() {
        self.ble = BLEManager.shared
    }

    /// Begin consuming inbound data, framing on the `>` prompt. Idempotent —
    /// `BLEManager.shared.inboundStream` is a single AsyncStream and Swift's
    /// `makeAsyncIterator()` is documented as undefined-behavior to call
    /// twice, so we only ever spawn one iterating task per app lifetime.
    /// Subsequent calls just clear the log + line buffer so the UI shows
    /// a fresh adapter-log view on reconnects.
    func attach() {
        log.removeAll()
        lineBuffer = ""
        if inboundTask != nil { return }
        let stream = ble.inboundStream
        inboundTask = Task { [weak self] in
            for await data in stream {
                guard let self else { break }
                // Log raw bytes as hex so we can see exactly what the adapter
                // sends, separate from the framed `>`-terminated responses.
                // Critical for debugging when the framing seems to swallow
                // a response.
                let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
                self.recordLog(.info, "raw " + hex)
                guard let chunk = String(data: data, encoding: .ascii) else { continue }
                self.consume(chunk)
            }
        }
    }

    /// Clear in-flight command state, but deliberately keep the inbound
    /// task alive. `BLEManager.shared.inboundStream` is a single
    /// AsyncStream and re-iterating it (which a fresh `attach()` after a
    /// `task = nil` would do) hits Swift's documented "calling
    /// `makeAsyncIterator()` twice = undefined behavior" path. The
    /// observable symptom was that after a Disconnect → Reconnect cycle,
    /// the ELM init handshake would stall after the first response and
    /// the user would see only ~2 entries in the adapter log instead of
    /// the usual 24, with logging then failing to start. Keeping the
    /// inbound task across detach/attach preserves the single iteration.
    func detach() {
        if let inFlight {
            inFlight.resume(throwing: ELMError.cancelled)
            self.inFlight = nil
        }
        timeoutTask?.cancel()
        timeoutTask = nil
        lineBuffer = ""
    }

    /// Send a command and await the framed response (everything before the
    /// next `>` prompt, with `\r\n` whitespace trimmed).
    func send(_ command: String, timeout: TimeInterval = 6.0) async throws -> String {
        if inFlight != nil { throw ELMError.busy }
        let framed = command + "\r"
        guard let outbound = framed.data(using: .ascii) else {
            throw ELMError.invalidCommand
        }
        recordLog(.tx, command)

        let response: String = try await withCheckedThrowingContinuation { continuation in
            self.inFlight = continuation
            self.timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard let self, let in0 = self.inFlight else { return }
                self.inFlight = nil
                in0.resume(throwing: ELMError.timeout(command: command))
            }
            Task {
                do {
                    try await self.ble.send(outbound)
                } catch {
                    self.timeoutTask?.cancel()
                    self.timeoutTask = nil
                    if let in0 = self.inFlight {
                        self.inFlight = nil
                        in0.resume(throwing: error)
                    }
                }
            }
        }

        recordLog(.rx, response)
        return response
    }

    /// Run the standard ELM327 init sequence. Returns the firmware banner
    /// string from `ATZ` (handy for debugging).
    func initSequence() async throws -> String {
        NSLog("[OBD2-ELM] initSequence: start")
        recordLog(.info, "Init sequence starting…")
        let banner = try await send("ATZ", timeout: 6.0)
        // 100ms inter-command delay. Was 500ms post-ATE0 in PR #18 as
        // defensive padding; reverting now that we have proper notify
        // confirmation + flow control.
        try await expectOK("ATE0", postDelayMs: 100)
        try await expectOK("ATL0", postDelayMs: 100)
        try await expectOK("ATS0", postDelayMs: 100)
        try await expectOK("ATH0", postDelayMs: 100)
        try await expectOK("ATSP0", postDelayMs: 100)
        try await expectOK("ATCAF1")
        NSLog("[OBD2-ELM] initSequence: done")
        recordLog(.info, "Init sequence OK.")
        return banner.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Internals

    private func consume(_ chunk: String) {
        lineBuffer += chunk
        // Frame on the prompt character; everything before `>` is one response.
        while let promptRange = lineBuffer.range(of: ">") {
            let body = String(lineBuffer[..<promptRange.lowerBound])
            lineBuffer.removeSubrange(..<promptRange.upperBound)
            let cleaned = body
                .replacingOccurrences(of: "\r", with: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            deliver(cleaned)
        }
    }

    private func deliver(_ response: String) {
        timeoutTask?.cancel()
        timeoutTask = nil
        if let continuation = inFlight {
            inFlight = nil
            continuation.resume(returning: response)
        } else {
            // Unsolicited frame; just log it.
            recordLog(.rx, response)
        }
    }

    private func expectOK(_ command: String, postDelayMs: Int = 0) async throws {
        NSLog("[OBD2-ELM] expectOK(\(command)): sending")
        let response = try await send(command)
        NSLog("[OBD2-ELM] expectOK(\(command)): got response \"\(response.replacingOccurrences(of: "\n", with: "\\n"))\"")
        let normalized = response.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.contains("OK") else {
            NSLog("[OBD2-ELM] expectOK(\(command)): FAIL — \"OK\" not in response")
            throw ELMError.unexpectedResponse(command: command, response: response)
        }
        if postDelayMs > 0 {
            NSLog("[OBD2-ELM] expectOK(\(command)): sleeping \(postDelayMs)ms")
            try await Task.sleep(nanoseconds: UInt64(postDelayMs) * 1_000_000)
            NSLog("[OBD2-ELM] expectOK(\(command)): sleep done")
        }
    }

    private func recordLog(_ direction: Direction, _ text: String) {
        log.append(LogEntry(direction: direction, text: text, timestamp: Date()))
        if log.count > maxLogEntries {
            log.removeFirst(log.count - maxLogEntries)
        }
    }
}

enum ELMError: LocalizedError {
    case busy
    case invalidCommand
    case timeout(command: String)
    case unexpectedResponse(command: String, response: String)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .busy: return "Adapter is busy with another command."
        case .invalidCommand: return "Invalid command (non-ASCII?)."
        case .timeout(let command): return "Adapter did not respond to '\(command)' in time."
        case .unexpectedResponse(let command, let response):
            return "Unexpected response to '\(command)': \(response)"
        case .cancelled: return "Cancelled."
        }
    }
}
