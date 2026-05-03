import Foundation

enum VINReader {
    /// Send Mode 09 PID 02 (Vehicle ID) and parse the 17-byte VIN out of the
    /// multi-frame ISO-TP response. Returns nil if the ECU doesn't respond
    /// with a VIN, or the parsed string isn't a 17-char alphanumeric VIN.
    @MainActor
    static func read(elm: ELM327) async throws -> String? {
        // First OBD2 query after ATSP0 triggers protocol auto-detect on the
        // adapter, which can take 4–6s on Veepeak units. Send a benign 0100
        // (supported PIDs Mode 01) as a warmup so the protocol is latched
        // before the multi-frame Mode 09 query. Swallow timeouts here — if
        // the warmup fails the 0902 retry loop below will still report.
        do {
            _ = try await elm.send("0100", timeout: 8.0)
        } catch {
            NSLog("[OBD2-VIN] 0100 warmup failed: \(error) — proceeding to 0902 anyway")
        }

        let response = try await sendWithRetry(elm: elm, command: "0902", timeout: 8.0, retries: 1)
        NSLog("[OBD2-VIN] 0902 raw response: \"\(response.replacingOccurrences(of: "\n", with: "\\n"))\"")
        return parseVINResponse(response)
    }

    /// Parses a Mode 09 PID 02 response into a 17-char VIN. Mirrors the web
    /// app's `parseVinResponse` in `src/obd/vin.ts`.
    ///
    /// Strategy (permissive — adapters format differently):
    ///   1. Split on whitespace; drop empty lines.
    ///   2. Strip leading frame-index prefixes like `0:`, `1:`, `2:` that some
    ///      adapters emit on multi-frame responses.
    ///   3. Concatenate into one big hex string and uppercase.
    ///   4. Locate `4902` (positive response to Mode 09 PID 02).
    ///   5. Skip past `4902` + the 1-byte message count → hex-decode the rest
    ///      to ASCII, mapping non-printable bytes to space.
    ///   6. First 17-char run of valid VIN chars wins.
    static func parseVINResponse(_ response: String) -> String? {
        let lines = response
            .components(separatedBy: .whitespacesAndNewlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map(stripFrameIndex)
        let concatenated = lines.joined().uppercased()
        guard let headerRange = concatenated.range(of: "4902") else { return nil }
        // 4902 is 4 hex chars; skip 2 more for the message-count byte (typ. 01).
        let dataStart = concatenated.index(headerRange.upperBound, offsetBy: 2, limitedBy: concatenated.endIndex) ?? concatenated.endIndex
        let dataHex = String(concatenated[dataStart...])
        let ascii = hexToAscii(dataHex)
        return firstVINMatch(in: ascii)
    }

    /// Drops a `<digit>:` prefix on lines like `0:4902014A` → `4902014A`.
    private static func stripFrameIndex(_ line: String) -> String {
        guard let colonIdx = line.firstIndex(of: ":") else { return line }
        let prefix = line[..<colonIdx]
        // Frame indices are short single-digit (sometimes 2-digit) hex counters.
        guard prefix.count <= 2, prefix.allSatisfy({ $0.isHexDigit }) else { return line }
        return String(line[line.index(after: colonIdx)...])
    }

    private static func hexToAscii(_ hex: String) -> String {
        var out = ""
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
            guard hex.distance(from: idx, to: next) == 2 else { break }
            let pair = String(hex[idx..<next])
            if let byte = UInt8(pair, radix: 16) {
                if byte >= 0x20 && byte < 0x7F {
                    out.append(Character(UnicodeScalar(byte)))
                } else {
                    out.append(" ")
                }
            }
            idx = next
        }
        return out
    }

    private static func firstVINMatch(in ascii: String) -> String? {
        // VIN: 17 chars, alphanumeric, no I/O/Q.
        let allowed: Set<Character> = Set("ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
        let chars = Array(ascii)
        guard chars.count >= 17 else { return nil }
        for start in 0...(chars.count - 17) {
            let slice = chars[start..<(start + 17)]
            if slice.allSatisfy({ allowed.contains($0) }) {
                return String(slice)
            }
        }
        return nil
    }

    @MainActor
    private static func sendWithRetry(elm: ELM327, command: String, timeout: TimeInterval, retries: Int) async throws -> String {
        var lastError: Error?
        for attempt in 0...retries {
            do {
                return try await elm.send(command, timeout: timeout)
            } catch let err as ELMError {
                if case .timeout = err, attempt < retries {
                    NSLog("[OBD2-VIN] \(command) timeout on attempt \(attempt + 1); retrying")
                    lastError = err
                    continue
                }
                throw err
            }
        }
        throw lastError ?? ELMError.timeout(command: command)
    }

}
