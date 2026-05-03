import Foundation

/// Decodes a 17-char VIN via NHTSA's free public vPIC API.
/// Mirrors `src/lib/nhtsa.ts` from the web app.
enum NHTSAClient {

    struct Decoded: Equatable {
        let year: Int?
        let make: String
        let model: String
        let trim: String
        let fuelTypePrimary: String?
        let fuelTypeSecondary: String?
    }

    enum DecodeError: LocalizedError {
        case invalidVIN
        case http(Int)
        case transport(String)
        case parse

        var errorDescription: String? {
            switch self {
            case .invalidVIN: return "Invalid VIN format."
            case .http(let code): return "NHTSA returned HTTP \(code)."
            case .transport(let msg): return msg
            case .parse: return "Could not parse NHTSA response."
            }
        }
    }

    static func decode(vin: String) async throws -> Decoded {
        guard isValidVINFormat(vin) else { throw DecodeError.invalidVIN }
        let encoded = vin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? vin
        guard let url = URL(string: "https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/\(encoded)?format=json") else {
            throw DecodeError.transport("Bad URL.")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            throw DecodeError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DecodeError.http(http.statusCode)
        }
        guard
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let results = raw["Results"] as? [[String: Any]]
        else {
            throw DecodeError.parse
        }
        var map: [String: String] = [:]
        for row in results {
            guard let key = row["Variable"] as? String else { continue }
            if let v = row["Value"] as? String, !v.isEmpty {
                map[key] = v
            }
        }
        let year: Int? = {
            guard let s = map["Model Year"], let n = Int(s) else { return nil }
            return n
        }()
        return Decoded(
            year: year,
            make: titleCase(map["Make"]),
            model: map["Model"] ?? "",
            trim: map["Trim"] ?? "",
            fuelTypePrimary: map["Fuel Type - Primary"],
            fuelTypeSecondary: map["Fuel Type - Secondary"]
        )
    }

    static func isValidVINFormat(_ candidate: String) -> Bool {
        guard candidate.count == 17 else { return false }
        // VINs use no I, O, Q.
        let allowed = CharacterSet(charactersIn: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
        return candidate.uppercased().unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func titleCase(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        return value
            .lowercased()
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}
