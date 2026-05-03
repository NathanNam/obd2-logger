import Foundation
import Observation

/// Loads JSON profiles bundled into the app at build time. The profiles ship
/// from `../src/profiles/builtin/` (see `project.yml`), so they're identical
/// to the ones the web app uses.
@MainActor
@Observable
final class ProfileRegistry {

    private(set) var profiles: [Profile] = []
    private(set) var loadError: String?

    static let shared = ProfileRegistry()

    init() {
        load()
    }

    func profile(id: String) -> Profile? {
        profiles.first { $0.profileId == id }
    }

    /// Heuristic: pick the first profile whose `vehicle_match` lists this
    /// make + (optional) year. Falls back to "generic-obd2".
    func suggestedProfile(make: String?, year: Int?) -> Profile {
        if let make = make?.lowercased() {
            for p in profiles {
                guard let match = p.vehicleMatch else { continue }
                if let pmake = match.make?.lowercased(), pmake == make {
                    if let year, let lo = match.yearMin, let hi = match.yearMax {
                        if year >= lo && year <= hi { return p }
                    } else {
                        return p
                    }
                }
            }
            // Generic Toyota Hybrid for any Toyota / Lexus / Scion w/o explicit match
            if ["toyota", "lexus", "scion"].contains(make) {
                if let toyota = profile(id: "generic-toyota-hybrid") { return toyota }
            }
        }
        return profile(id: "generic-obd2") ?? profiles.first!
    }

    func reload() {
        load()
    }

    // MARK: - Internals

    private func load() {
        loadError = nil
        var loaded: [Profile] = []

        // The xcodegen `path: ../src/profiles/builtin` source builds to a
        // `Profiles` folder reference inside the app bundle. Resolve it.
        guard let profilesDir = Bundle.main.url(
            forResource: "Profiles",
            withExtension: nil
        ) else {
            loadError = "Profiles directory missing from app bundle. Run xcodegen."
            return
        }

        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: profilesDir, includingPropertiesForKeys: nil) else {
            loadError = "Could not list profiles directory at \(profilesDir.path)."
            return
        }

        for url in entries where url.pathExtension.lowercased() == "json" {
            do {
                let data = try Data(contentsOf: url)
                let profile = try JSONDecoder().decode(Profile.self, from: data)
                loaded.append(profile)
            } catch {
                loadError = "Failed to parse \(url.lastPathComponent): \(error.localizedDescription)"
            }
        }

        // Stable ordering: generic first, then alphabetical by display name.
        loaded.sort { lhs, rhs in
            let lg = lhs.profileId.hasPrefix("generic-")
            let rg = rhs.profileId.hasPrefix("generic-")
            if lg != rg { return lg }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }

        profiles = loaded
    }
}
