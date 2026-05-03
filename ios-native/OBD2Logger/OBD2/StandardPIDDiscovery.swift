import Foundation

enum StandardPIDDiscovery {
    /// Send `0100` / `0120` / `0140` / `0160` / `0180` / `01A0` / `01C0`
    /// and walk the supported-PID bitmaps to enumerate every standard PID
    /// the ECU declares it supports. Returns hex pid strings ("0C", "1F", …).
    @MainActor
    static func discover(elm: ELM327) async throws -> [String] {
        var supported: [Int] = []
        var nextRange = 0x00 // start with PIDs 01-20 (request "0100")
        while nextRange <= 0xC0 {
            let request = String(format: "01%02X", nextRange)
            let response: String
            do {
                response = try await elm.send(request, timeout: 3.0)
            } catch {
                break
            }
            guard let bitmap = parseBitmap(response: response, requestedPid: nextRange) else {
                break
            }
            // Bitmap covers 32 PIDs starting at requestedPid + 1.
            for bit in 0..<32 {
                let mask = UInt32(0x80000000) >> bit
                if bitmap & mask != 0 {
                    supported.append(nextRange + 1 + bit)
                }
            }
            // Bit 0 (the MSB) of the response indicates support for the *next*
            // bitmap PID. If it's set, continue.
            let nextSupported = bitmap & UInt32(0x80000000) != 0
            // Actually: bit 0 of the *next* bitmap PID corresponds to PID
            // (nextRange + 0x20). Standard practice: keep going while the
            // bitmap's MSB indicates support for the next bitmap.
            // (PID 0x20 supports → continues to 21-40; PID 0x40 supports →
            // continues to 41-60; etc.)
            _ = nextSupported // (kept for clarity; we always advance)
            nextRange += 0x20
        }
        return supported.map { String(format: "%02X", $0) }
    }

    /// Pull 4 bytes out of the `41 XX BB BB BB BB` response and combine to
    /// a 32-bit big-endian bitmap. Returns nil if the response doesn't match.
    private static func parseBitmap(response: String, requestedPid: Int) -> UInt32? {
        guard let bytes = HexParsing.bytes(
            response
                .replacingOccurrences(of: " ", with: "")
                .replacingOccurrences(of: "\n", with: "")
                .replacingOccurrences(of: "\r", with: "")
        ) else { return nil }
        // Find "41 PP" (positive response to mode 01, PID requestedPid).
        let pp = UInt8(requestedPid)
        for i in 0..<(bytes.count - 5) {
            if bytes[i] == 0x41 && bytes[i + 1] == pp {
                let b0 = UInt32(bytes[i + 2])
                let b1 = UInt32(bytes[i + 3])
                let b2 = UInt32(bytes[i + 4])
                let b3 = UInt32(bytes[i + 5])
                return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
            }
        }
        return nil
    }
}
