import Foundation

struct Vehicle: Codable, Identifiable, Hashable {
    let slug: String
    let owner: String
    var displayName: String
    var year: Int?
    var make: String?
    var model: String?
    var trim: String?
    var vin: String?
    var profileId: String
    var profileVersion: String
    let createdAtUTC: String
    var lastUsedUTC: String?
    var supportedStandardPIDs: [String]
    var supportedProfilePIDs: [String]
    var disabledPIDs: [String]

    var id: String { slug }

    enum CodingKeys: String, CodingKey {
        case slug, owner
        case displayName = "display_name"
        case year, make, model, trim, vin
        case profileId = "profile_id"
        case profileVersion = "profile_version"
        case createdAtUTC = "created_at_utc"
        case lastUsedUTC = "last_used_utc"
        case supportedStandardPIDs = "supported_standard_pids"
        case supportedProfilePIDs = "supported_profile_pids"
        case disabledPIDs = "disabled_pids"
    }

    static func makeSlug(year: Int?, make: String?, model: String?) -> String {
        var parts: [String] = []
        if let year = year, year > 0 { parts.append(String(year)) }
        if let make = make, !make.isEmpty { parts.append(make) }
        if let model = model, !model.isEmpty { parts.append(model) }
        let joined = parts.joined(separator: "-").lowercased()
        let cleaned = joined
            .components(separatedBy: CharacterSet.alphanumerics.union(.init(charactersIn: "-")).inverted)
            .joined()
        // Collapse multiple dashes, trim leading/trailing.
        let collapsed = cleaned.replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
        return String(collapsed.trimmingCharacters(in: .init(charactersIn: "-")).prefix(64))
    }

    static func makeDisplayName(year: Int?, make: String?, model: String?, trim: String?) -> String {
        var parts: [String] = []
        if let year = year, year > 0 { parts.append(String(year)) }
        if let make = make, !make.isEmpty { parts.append(make) }
        if let model = model, !model.isEmpty { parts.append(model) }
        if let trim = trim, !trim.isEmpty { parts.append(trim) }
        return parts.joined(separator: " ")
    }
}
