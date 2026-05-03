import Foundation
import Observation

/// App-wide settings persisted in `UserDefaults`. Keeps things simple — no
/// IndexedDB equivalent needed since iOS gives us defaults for free.
@MainActor
@Observable
final class SettingsStore {

    var owner: String {
        didSet { UserDefaults.standard.set(owner, forKey: Keys.owner) }
    }
    var activeVehicleSlug: String? {
        didSet { UserDefaults.standard.set(activeVehicleSlug, forKey: Keys.activeVehicleSlug) }
    }
    var sampleRateHz: Double {
        didSet { UserDefaults.standard.set(sampleRateHz, forKey: Keys.sampleRateHz) }
    }
    var rawCapture: Bool {
        didSet { UserDefaults.standard.set(rawCapture, forKey: Keys.rawCapture) }
    }
    var autoDecodeVIN: Bool {
        didSet { UserDefaults.standard.set(autoDecodeVIN, forKey: Keys.autoDecodeVIN) }
    }

    static let shared = SettingsStore()

    private enum Keys {
        static let owner = "owner"
        static let activeVehicleSlug = "active_vehicle_slug"
        static let sampleRateHz = "sample_rate_hz"
        static let rawCapture = "raw_capture"
        static let autoDecodeVIN = "auto_decode_vin"
    }

    init() {
        let defaults = UserDefaults.standard
        self.owner = defaults.string(forKey: Keys.owner) ?? ""
        self.activeVehicleSlug = defaults.string(forKey: Keys.activeVehicleSlug)
        let storedRate = defaults.double(forKey: Keys.sampleRateHz)
        self.sampleRateHz = storedRate == 0 ? 1.0 : storedRate
        self.rawCapture = defaults.bool(forKey: Keys.rawCapture)
        self.autoDecodeVIN = defaults.object(forKey: Keys.autoDecodeVIN) as? Bool ?? true
    }
}
