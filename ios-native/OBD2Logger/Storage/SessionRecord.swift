import Foundation

struct SessionRecord: Codable, Identifiable, Hashable {
    let sessionID: String
    let startUTC: String
    let endUTC: String
    let durationMs: Int
    let sampleRateHz: Double
    let rowCount: Int
    let profileID: String
    let profileVersion: String
    let pidCount: Int
    let file: String
    let endedReason: String
    let meanPidCompletionPct: Double
    let rawMode: Bool

    var id: String { sessionID }

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case startUTC = "start_utc"
        case endUTC = "end_utc"
        case durationMs = "duration_ms"
        case sampleRateHz = "sample_rate_hz"
        case rowCount = "row_count"
        case profileID = "profile_id"
        case profileVersion = "profile_version"
        case pidCount = "pid_count"
        case file
        case endedReason = "ended_reason"
        case meanPidCompletionPct = "mean_pid_completion_pct"
        case rawMode = "raw_mode"
    }
}

enum SessionID {
    /// 8-char Crockford-style ID; matches the format used by the web app.
    static func generate() -> String {
        let alphabet = Array("0123456789abcdefghjkmnpqrstvwxyz")
        var bytes = [UInt8](repeating: 0, count: 5)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        var out = ""
        for b in bytes {
            out.append(alphabet[Int(b) % alphabet.count])
        }
        // Pad to 8 characters with random alphabet chars.
        for _ in 0..<3 {
            out.append(alphabet[Int.random(in: 0..<alphabet.count)])
        }
        return out
    }

    static func sessionFilename(startISO: String, sessionID: String) -> String {
        let safe = startISO.replacingOccurrences(of: ":", with: "-")
        let stripped = safe.replacingOccurrences(of: ".\\d{3}Z", with: "Z", options: .regularExpression)
        return "\(stripped)__\(sessionID).csv"
    }
}
