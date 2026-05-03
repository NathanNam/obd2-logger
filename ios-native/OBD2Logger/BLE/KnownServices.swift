import CoreBluetooth

/// Service UUIDs known to host OBD2-over-BLE traffic. Order matters — earlier
/// entries are tried first when probing the GATT after the user picks a device.
/// Sourced from real adapters (Veepeak / vLinker / OBDLink / generic ELM327
/// clones) and matches the web app's `src/obd/adapters.ts` so both targets
/// recognize the same hardware. When scanning, we filter by these UUIDs to
/// keep the picker free of AirPods / smart-home noise.
enum KnownServices {
    /// 16-bit UUIDs in their full 128-bit form, ordered by priority.
    static let serviceUUIDs: [CBUUID] = [
        CBUUID(string: "FFF0"),                               // most common ELM327 BLE clones (Veepeak BLE+, etc.)
        CBUUID(string: "FFE0"),                               // HM-10 / alternate ELM327 BLE family
        CBUUID(string: "FFE5"),                               // some Veepeak / Vgate variants
        CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"), // Nordic UART (NUS)
        CBUUID(string: "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"), // Nordic UART variant in some clones
        CBUUID(string: "1101"),                               // Bluetooth Classic SPP UUID (some hybrid adapters expose it on BLE)
    ]
}
