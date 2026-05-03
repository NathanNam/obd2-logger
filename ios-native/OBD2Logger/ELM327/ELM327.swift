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

    /// Begin consuming inbound data, framing on the `>` prompt.
    func attach() {
        inboundTask?.cancel()
        let stream = ble.inboundStream
        inboundTask = Task { [weak self] in
            for await data in stream {
                guard let self else { break }
                guard let chunk = String(data: data, encoding: .ascii) else { continue }
                self.consume(chunk)
            }
        }
    }

    func detach() {
        inboundTask?.cancel()
        inboundTask = nil
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
        recordLog(.info, "Init sequence starting…")
        // ATZ: warm reset; banner contains "ELM327 v..."
        let banner = try await send("ATZ", timeout: 3.0)
        // Adapter sometimes echoes `ATZ` before the banner; just take everything.
        try await expectOK("ATE0") // turn off echo
        try await expectOK("ATL0") // line feeds off
        try await expectOK("ATS0") // spaces off
        try await expectOK("ATH0") // headers off (hide CAN headers in responses)
        try await expectOK("ATSP0") // auto-detect protocol
        try await expectOK("ATCAF1") // CAN automatic formatting (ISO-TP reassembly)
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

    private func expectOK(_ command: String) async throws {
        let response = try await send(command)
        let normalized = response.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.contains("OK") else {
            throw ELMError.unexpectedResponse(command: command, response: response)
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
