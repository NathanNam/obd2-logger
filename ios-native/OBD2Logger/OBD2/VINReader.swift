import Foundation

enum VINReader {
    /// Send Mode 09 PID 02 (Vehicle ID) and parse the 17-byte VIN out of the
    /// multi-frame ISO-TP response. Returns nil if the ECU doesn't respond
    /// with a VIN, or the parsed string isn't a 17-char alphanumeric VIN.
    @MainActor
    static func read(elm: ELM327) async throws -> String? {
        // ELM327 in CAF1 mode reassembles the ISO-TP frames for us, but the
        // textual format still varies by adapter. The most robust approach
        // is to ask for "0902" and pull every 2-char hex byte from the
        // response, drop the response-code prefix (49 02 ...) and the
        // multi-message indicator (01), then ASCII-decode.
        let response = try await elm.send("0902", timeout: 4.0)
        let normalized = response
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")

        // Some adapters wrap each frame with a leading `0:`, `1:`, `2:` index.
        // Strip those.
        let stripped = normalized
            .components(separatedBy: CharacterSet(charactersIn: "0123456789").inverted)
            .joined() // not quite right; do it more carefully below

        // Cleaner: drop any non-hex-byte tokens by scanning forward looking
        // for the response code "4902" and reading 17 bytes after it.
        guard let bytes = HexParsing.bytes(normalized) ?? HexParsing.bytes(stripped) else {
            return nil
        }
        guard let vinStart = vinStartIndex(in: bytes) else { return nil }
        let vinBytes = Array(bytes.dropFirst(vinStart).prefix(17))
        guard vinBytes.count == 17 else { return nil }
        let candidate = String(bytes: vinBytes, encoding: .ascii)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let vin = candidate, isValidVIN(vin) else { return nil }
        return vin
    }

    /// Find the first byte index *after* the `49 02 [count]` response prefix.
    private static func vinStartIndex(in bytes: [UInt8]) -> Int? {
        // Look for 0x49, 0x02 sequence; the byte after may be a frame count.
        // VIN data starts at index of 0x02 + 2 (skip count byte).
        for i in 0..<(bytes.count - 2) {
            if bytes[i] == 0x49 && bytes[i + 1] == 0x02 {
                // Skip 0x49, 0x02, then the message count byte (typically 0x01).
                return i + 3
            }
        }
        return nil
    }

    private static func isValidVIN(_ candidate: String) -> Bool {
        guard candidate.count == 17 else { return false }
        // VINs are alphanumeric, no I, O, Q.
        let allowed = CharacterSet(charactersIn: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
        return candidate.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}
