import Foundation

enum HexParsing {
    /// Convert a hex string ("0BAD" or "0b ad") to bytes. Returns nil if the
    /// input has odd length or contains non-hex chars.
    static func bytes(_ hex: String) -> [UInt8]? {
        let cleaned = hex.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
        guard cleaned.count.isMultiple(of: 2) else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(cleaned.count / 2)
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            guard let byte = UInt8(cleaned[index..<next], radix: 16) else { return nil }
            out.append(byte)
            index = next
        }
        return out
    }

    static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02X", $0) }.joined()
    }
}
