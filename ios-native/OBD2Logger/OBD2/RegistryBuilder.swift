import Foundation

/// Builds a combined PID registry from standard Mode-01 PIDs (discovered via
/// the supported-PIDs bitmap sweep) and profile-specific PIDs (probed against
/// the live ECU). Mirrors `src/obd/registry-builder.ts`.
enum RegistryBuilder {

    /// Stable category sort order — matches the web app for parity.
    private static let categoryOrder: [PidCategory: Int] = [
        .engine: 0,
        .hybrid: 1,
        .battery: 2,
        .transmission: 3,
        .emissions: 4,
        .diagnostics: 5,
        .other: 6,
    ]

    /// Combine standard + profile PIDs into one sampling list.
    /// - `supportedStandardPIDs` are hex PID strings ("0C", "1F", …) from the
    ///   bitmap sweep; each is looked up in `StandardPids`. Bitmask metadata
    ///   PIDs ("00"/"20"/…) and any standard PID we don't have a definition
    ///   for are skipped.
    /// - `supportedProfilePIDs` are profile-PID `id`s; the matching `PidDef`
    ///   from `profile.pids` is included.
    /// - `disabledPIDs` (from the vehicle record) are filtered out.
    static func build(
        profile: Profile,
        supportedStandardPIDs: [String],
        supportedProfilePIDs: [String],
        disabledPIDs: [String]
    ) -> [PidDef] {
        let disabled = Set(disabledPIDs)
        var entries: [PidDef] = []

        for hex in supportedStandardPIDs {
            let upper = hex.uppercased()
            if StandardPids.bitmaskPIDs.contains(upper) { continue }
            guard let def = StandardPids.get(upper) else { continue }
            if disabled.contains(def.id) { continue }
            entries.append(def)
        }

        let profileSupported = Set(supportedProfilePIDs)
        for pid in profile.pids {
            if !profileSupported.contains(pid.id) { continue }
            if disabled.contains(pid.id) { continue }
            entries.append(pid)
        }

        return entries.sorted { a, b in
            let ca = categoryOrder[a.category] ?? 99
            let cb = categoryOrder[b.category] ?? 99
            if ca != cb { return ca < cb }
            if a.ecu != b.ecu { return a.ecu < b.ecu }
            return a.id < b.id
        }
    }
}
