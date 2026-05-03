import Foundation

enum PidCategory: String, Codable {
    case engine, hybrid, battery, transmission, emissions, diagnostics, other
}

struct PidDef: Codable, Identifiable, Hashable {
    let id: String
    let displayName: String
    let ecu: String
    let mode: String
    let pid: String
    let unit: String
    let formula: String
    let category: PidCategory
    let min: Double?
    let max: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case ecu, mode, pid, unit, formula, category, min, max
    }
}

struct EcuDef: Codable, Hashable {
    let requestHeader: String
    let responseHeader: String

    enum CodingKeys: String, CodingKey {
        case requestHeader = "request_header"
        case responseHeader = "response_header"
    }
}

struct VehicleMatch: Codable, Hashable {
    let make: String?
    let models: [String]?
    let yearMin: Int?
    let yearMax: Int?

    enum CodingKeys: String, CodingKey {
        case make, models
        case yearMin = "year_min"
        case yearMax = "year_max"
    }
}

struct ValidationEntry: Codable, Hashable {
    let vehicle: String
    let date: String
    let notes: String?
}

struct Profile: Codable, Identifiable, Hashable {
    let profileId: String
    let profileVersion: String
    let displayName: String
    let description: String?
    let vehicleMatch: VehicleMatch?
    let ecus: [String: EcuDef]
    let pids: [PidDef]
    let sources: [String]?
    let validatedAgainst: [ValidationEntry]?

    var id: String { profileId }

    enum CodingKeys: String, CodingKey {
        case profileId = "profile_id"
        case profileVersion = "profile_version"
        case displayName = "display_name"
        case description
        case vehicleMatch = "vehicle_match"
        case ecus, pids, sources
        case validatedAgainst = "validated_against"
    }
}
