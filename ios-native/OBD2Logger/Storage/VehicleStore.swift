import Foundation
import Observation

/// Persists `Vehicle` records as `vehicle.json` files under
/// `data/<owner>/<slug>/`. Holds an in-memory cache for the UI.
@MainActor
@Observable
final class VehicleStore {

    private(set) var vehicles: [Vehicle] = []
    private(set) var loadError: String?

    static let shared = VehicleStore()

    /// Load every vehicle for `owner`. Replaces the in-memory cache.
    func reload(owner: String) {
        loadError = nil
        var loaded: [Vehicle] = []
        do {
            try AppStorage.shared.ensureDir(AppPath.ownerDir(owner))
        } catch {
            loadError = "Could not create owner directory: \(error.localizedDescription)"
            return
        }
        let entries: [URL]
        do {
            entries = try AppStorage.shared.listDir(AppPath.ownerDir(owner))
        } catch {
            loadError = "Could not list owner directory: \(error.localizedDescription)"
            return
        }
        for url in entries where url.hasDirectoryPath {
            let slug = url.lastPathComponent
            do {
                let v = try AppStorage.shared.readJSON(
                    Vehicle.self,
                    from: AppPath.vehicleJSON(owner, slug)
                )
                loaded.append(v)
            } catch {
                // Skip directories without a parseable vehicle.json.
                continue
            }
        }
        loaded.sort { (a, b) in
            (a.lastUsedUTC ?? a.createdAtUTC) > (b.lastUsedUTC ?? b.createdAtUTC)
        }
        vehicles = loaded
    }

    func save(_ vehicle: Vehicle) throws {
        try AppStorage.shared.ensureDir(AppPath.vehicleDir(vehicle.owner, vehicle.slug))
        try AppStorage.shared.writeJSON(vehicle, to: AppPath.vehicleJSON(vehicle.owner, vehicle.slug))
        if let idx = vehicles.firstIndex(where: { $0.slug == vehicle.slug }) {
            vehicles[idx] = vehicle
        } else {
            vehicles.append(vehicle)
        }
    }

    func delete(slug: String, owner: String) throws {
        try AppStorage.shared.remove(AppPath.vehicleDir(owner, slug))
        vehicles.removeAll { $0.slug == slug }
    }
}
