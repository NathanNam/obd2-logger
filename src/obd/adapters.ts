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
  // Filter the picker to devices that advertise one of the known OBD2
  // service UUIDs. Earlier we used `acceptAllDevices: true` to be tolerant
  // of inconsistent adapter *names*, but Chrome's macOS implementation of
  // `acceptAllDevices` is unreliable for devices that don't broadcast rich
  // advertisement metadata — Veepeak units in particular often don't show
  // up at all in the picker even when chrome://bluetooth-internals proves
  // Chrome has seen them advertise. Service-UUID filters use a different
  // scan code path and reliably surface those devices. This is also what
  // CoreBluetooth on iOS uses (`scanForPeripherals(withServices: ...)`).
  //
  // The downside is an OBD2 adapter that doesn't include any service UUID
  // in its advertisement packet would not appear here. If you encounter
  // that, add the adapter's service UUID to KNOWN_OBD_SERVICE_UUIDS above.
  return {
    filters: KNOWN_OBD_SERVICE_UUIDS.map((service) => ({ services: [service] })),
    optionalServices: KNOWN_OBD_SERVICE_UUIDS,
  };
}
