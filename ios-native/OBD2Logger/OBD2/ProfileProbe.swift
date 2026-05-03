import Foundation

enum ProfileProbe {
    /// Test each profile-defined PID against the live connection. A PID is
    /// "supported" if the ECU returns a positive response (`4<mode><pid>`)
    /// rather than NO DATA, error, or no response at all. Returns the list
    /// of supported PID IDs (matching the profile's `pids[].id`).
    @MainActor
    static func probe(elm: ELM327, profile: Profile) async throws -> [String] {
        var supported: [String] = []
        // Group PIDs by ECU and set ATSH<request_header> once per group.
        // Mode 21 PIDs on non-engine ECUs (hybrid_controller, etc.) only
        // respond when explicitly addressed; the broadcast functional
        // address misses them and they get falsely marked unsupported.
        var grouped: [String: [PidDef]] = [:]
        for pid in profile.pids {
            grouped[pid.ecu, default: []].append(pid)
        }
        for ecuName in grouped.keys.sorted() {
            if let ecu = profile.ecus[ecuName] {
                _ = try? await elm.send("ATSH\(ecu.requestHeader)", timeout: 0.8)
            }
            for pidDef in grouped[ecuName] ?? [] {
                let request = pidDef.mode + pidDef.pid
                let positiveResponseCode = try positiveResponseCode(mode: pidDef.mode, pid: pidDef.pid)
                do {
                    let response = try await elm.send(request, timeout: 1.5)
                    let normalized = response
                        .uppercased()
                        .replacingOccurrences(of: " ", with: "")
                        .replacingOccurrences(of: "\n", with: "")
                        .replacingOccurrences(of: "\r", with: "")
                    if normalized.contains("NODATA") || normalized.contains("STOPPED") {
                        continue
                    }
                    if normalized.contains(positiveResponseCode) {
                        supported.append(pidDef.id)
                    }
                } catch {
                    // Timeout or transport error → skip this PID and keep going.
                    continue
                }
            }
        }
        return supported
    }

    /// Mode 01 → response code 0x41; mode 21 → 0x61; etc. (Add 0x40 to mode.)
    private static func positiveResponseCode(mode: String, pid: String) throws -> String {
        guard let modeByte = UInt8(mode, radix: 16) else { return "" }
        let positive = modeByte + 0x40
        return String(format: "%02X%@", positive, pid)
    }
}
