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

export function buildRequestDeviceOptions(): RequestDeviceOptions {
  // Show every nearby BLE device — adapter names vary widely (Veepeak units
  // alone have shipped as "OBDII", "IOS-Vlink", "OBDPro", etc.) and a
  // permissive picker is friendlier than guessing prefixes. The user picks;
  // we then probe the GATT for one of the known service UUIDs (and fall back
  // to scanning all primary services if none match).
  return {
    acceptAllDevices: true,
    optionalServices: KNOWN_OBD_SERVICE_UUIDS,
  };
}
