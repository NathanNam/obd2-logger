import Foundation

/// Validates an incoming profile JSON and saves it to `Documents/profiles/`.
/// Used by:
///   - In-app `UIDocumentPicker` (user taps Import profile…)
///   - `.onOpenURL` handler when the user shares a `.json` to OBD2 Logger
///     from another app (Files, Mail, Safari, AirDrop, iMessage).
enum ProfileImporter {
    enum ImportError: LocalizedError {
        case unreadable(String)
        case invalidJSON(String)
        case missingFields(String)
        case writeFailed(String)

        var errorDescription: String? {
            switch self {
            case .unreadable(let msg): return "Could not read the file: \(msg)"
            case .invalidJSON(let msg): return "Not a valid profile JSON: \(msg)"
            case .missingFields(let msg): return "Profile is missing required fields: \(msg)"
            case .writeFailed(let msg): return "Could not save the profile: \(msg)"
            }
        }
    }

    /// Import from a file URL (from the document picker or the open-in handler).
    /// On success returns the parsed profile.
    static func importProfile(from url: URL) throws -> Profile {
        // Document picker / Files URLs require security-scoped access.
        let needsScope = url.startAccessingSecurityScopedResource()
        defer {
            if needsScope { url.stopAccessingSecurityScopedResource() }
        }

        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw ImportError.unreadable(error.localizedDescription)
        }

        let profile: Profile
        do {
            profile = try JSONDecoder().decode(Profile.self, from: data)
        } catch let DecodingError.keyNotFound(key, _) {
            throw ImportError.missingFields(key.stringValue)
        } catch {
            throw ImportError.invalidJSON(error.localizedDescription)
        }

        if profile.profileId.isEmpty {
            throw ImportError.missingFields("profile_id")
        }
        if profile.pids.isEmpty {
            throw ImportError.missingFields("pids (must have at least one)")
        }

        // Save to Documents/profiles/<profile_id>.json (overwrites if exists).
        let target = "profiles/\(profile.profileId).json"
        do {
            try AppStorage.shared.ensureDir("profiles")
            // Re-encode rather than copying raw bytes so the on-disk version
            // is canonical (consistent formatting, key ordering).
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
            let canonical = try encoder.encode(profile)
            let dest = AppStorage.shared.url(for: target)
            try canonical.write(to: dest, options: .atomic)
        } catch {
            throw ImportError.writeFailed(error.localizedDescription)
        }

        return profile
    }
}
