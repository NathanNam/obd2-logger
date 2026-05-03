import Foundation

/// Quick "is the ECU answering?" probe. Send one cheap, universally-supported
/// Mode-01 query (`0100` — "which PIDs do you support") and look for a
/// positive response. If the vehicle isn't in READY mode (Toyota/Lexus
/// hybrids stay asleep until foot-on-brake push-start), the ECU returns
/// nothing — `0100` either times out or yields NO_DATA / `?`.
enum ECULiveness {

    /// Returns true if we got a `41 00 …` positive response. False on
    /// timeout, NO_DATA, STOPPED, `?`, or any other non-positive reply.
    @MainActor
    static func check(elm: ELM327) async throws -> Bool {
        let response: String
        do {
            // 4-second window: enough for ELM327's first-query protocol
            // auto-detect on a cold link, short enough to fail fast on a
            // silent ECU.
            response = try await elm.send("0100", timeout: 4.0)
        } catch {
            return false
        }
        let normalized = response
            .uppercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
        if normalized.contains("NODATA") { return false }
        if normalized.contains("STOPPED") { return false }
        if normalized.contains("UNABLETOCONNECT") { return false }
        if normalized.contains("BUSINIT") { return false }
        if normalized == "?" { return false }
        // Positive response to mode 01 PID 00 is "4100…".
        return normalized.contains("4100")
    }
}

enum LoggingSessionError: LocalizedError {
    case ecuNotResponding

    var errorDescription: String? {
        switch self {
        case .ecuNotResponding:
            return "ECU not responding — is the car in READY mode? Try foot-on-brake push-start, then tap Start logging again."
        }
    }
}
