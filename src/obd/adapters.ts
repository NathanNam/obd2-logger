// Service UUIDs known to host OBD2-over-BLE traffic. Order matters — earlier
// entries are tried first when probing the GATT after the user picks a device.
// Sourced from real adapters (Veepeak / vLinker / OBDLink / generic ELM327
// clones) and the obd2-scanner's empirically-validated list. We don't try to
// match characteristic UUIDs by hand — different firmware revisions of the
// same adapter ship different ones — so the BLE transport probes for any
// writable+notifiable pair within whichever service it finds.

export const KNOWN_OBD_SERVICE_UUIDS: BluetoothServiceUUID[] = [
  "0000fff0-0000-1000-8000-00805f9b34fb",   // most common ELM327 BLE clones (Veepeak BLE+ etc.)
  "0000ffe0-0000-1000-8000-00805f9b34fb",   // HM-10 / alternate ELM327 BLE family
  "0000ffe5-0000-1000-8000-00805f9b34fb",   // some Veepeak / Vgate variants
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",   // Nordic UART (NUS)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",   // Nordic UART variant seen in some clones
  "00001101-0000-1000-8000-00805f9b34fb",   // Bluetooth Classic SPP UUID (some hybrid adapters expose it on BLE)
];

/// Common name prefixes that BLE OBD2 adapters advertise. Many adapters
/// (Veepeak in particular) don't include their service UUIDs in the BLE
/// advertisement packet — only the local name — so service-UUID-only
/// filters miss them. Pairing name and service filters in the picker
/// gives us both code paths.
const KNOWN_OBD_NAME_PREFIXES: string[] = [
  "VEEPEAK",
  "OBDII",
  "OBD2",
  "OBDPro",
  "OBDLink",
  "vLinker",
  "VLink",
  "IOS-Vlink",
  "iCar",
  "Carista",
  "VL-",
  "ELM",
];

export function buildRequestDeviceOptions(): RequestDeviceOptions {
  // Two parallel filter strategies, OR'd by the picker:
  //   • By advertised name prefix — catches Veepeak units that broadcast
  //     "VEEPEAK" but don't include their service UUIDs in the BLE
  //     advertisement packet (a real and common Veepeak quirk).
  //   • By advertised service UUID — catches adapters that DO advertise
  //     their service UUIDs, including ones whose names we haven't yet
  //     enumerated.
  //
  // Earlier iterations tried `acceptAllDevices: true` (Chrome on macOS
  // unreliably surfaced Veepeaks even with that flag) and service-only
  // filters (missed Veepeaks because the FFF0 service is post-connect,
  // not advertised). The combined filter list works in both cases.
  //
  // If a user reports a new adapter not appearing, add its name prefix
  // to KNOWN_OBD_NAME_PREFIXES or its service UUID to
  // KNOWN_OBD_SERVICE_UUIDS — whichever the device actually advertises.
  return {
    filters: [
      ...KNOWN_OBD_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      ...KNOWN_OBD_SERVICE_UUIDS.map((service) => ({ services: [service] })),
    ],
    optionalServices: KNOWN_OBD_SERVICE_UUIDS,
  };
}
