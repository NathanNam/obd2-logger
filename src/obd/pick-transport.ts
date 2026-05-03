import { isNative } from "../lib/platform";
import { BleTransport } from "./ble-transport";
import { CapacitorBleTransport } from "./capacitor-ble-transport";
import type { Transport } from "./transport";

/**
 * Returns the right BLE transport for the current platform. On Capacitor
 * native shells (iOS / Android) we use the plugin so it can talk to
 * CoreBluetooth / Android BLE; on the web build we keep using
 * `navigator.bluetooth` directly.
 */
export async function pickBleTransport(): Promise<Transport> {
  if (isNative()) {
    return CapacitorBleTransport.pick();
  }
  return BleTransport.pick();
}
