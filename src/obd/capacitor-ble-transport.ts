import {
  BleClient,
  type BleCharacteristic,
  type BleService,
} from "@capacitor-community/bluetooth-le";

import { KNOWN_OBD_SERVICE_UUIDS } from "./adapters";
import {
  type PickedDescription,
  type Transport,
  type TransportEvent,
  type TransportListener,
} from "./transport";

const MAX_WRITE_CHUNK = 20;

type Picked = {
  serviceUuid: string;
  txUuid: string;
  rxUuid: string;
  txWriteWithoutResponse: boolean;
  source: "known" | "fallback";
};

/**
 * BLE transport backed by the Capacitor BLE plugin. Used on iOS / Android where
 * Web Bluetooth is unavailable, and as a uniform path on web if/when we ever
 * want a single transport for all platforms. The shape mirrors `BleTransport`
 * (Web Bluetooth) so the rest of the OBD stack is platform-agnostic.
 */
export class CapacitorBleTransport implements Transport {
  readonly id = "capacitor-ble";
  readonly label: string;

  private listeners = new Set<TransportListener>();
  private deviceId: string;
  private picked: Picked | null = null;
  private opened = false;

  constructor(deviceId: string, label: string) {
    this.deviceId = deviceId;
    this.label = label || "(unnamed BLE device)";
  }

  static async pick(): Promise<CapacitorBleTransport> {
    await BleClient.initialize({ androidNeverForLocation: true });

    // Filter the picker to devices advertising any known OBD2 service. iOS
    // requires a service filter (no acceptAllDevices equivalent in the
    // plugin); most ELM327 BLE adapters advertise at least one of these.
    const services = KNOWN_OBD_SERVICE_UUIDS.map((u) => u.toString().toLowerCase());
    const device = await BleClient.requestDevice({
      services,
      optionalServices: services,
    });
    return new CapacitorBleTransport(device.deviceId, device.name ?? "");
  }

  on(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: TransportEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // listener errors must not break the transport
      }
    }
  }

  isOpen(): boolean {
    return this.opened;
  }

  async open(): Promise<void> {
    await BleClient.connect(this.deviceId, () => {
      this.opened = false;
      this.emit({ kind: "close", reason: "GATT disconnected" });
    });

    let services: BleService[];
    try {
      services = await BleClient.getServices(this.deviceId);
    } catch (e) {
      await BleClient.disconnect(this.deviceId).catch(() => {});
      throw new Error(
        `Could not read GATT services on this adapter: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    this.picked = pickServiceWithFallback(services);
    if (!this.picked) {
      await BleClient.disconnect(this.deviceId).catch(() => {});
      throw new Error(
        "No BLE service on this adapter exposes the writable + notifiable characteristics needed for ELM327 communication. Check the adapter's manual or try a different adapter.",
      );
    }

    await BleClient.startNotifications(
      this.deviceId,
      this.picked.serviceUuid,
      this.picked.rxUuid,
      (value) => {
        this.emit({
          kind: "data",
          bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        });
      },
    );

    this.opened = true;
    this.emit({ kind: "open" });
  }

  async close(): Promise<void> {
    this.opened = false;
    if (this.picked) {
      await BleClient.stopNotifications(
        this.deviceId,
        this.picked.serviceUuid,
        this.picked.rxUuid,
      ).catch(() => {});
    }
    await BleClient.disconnect(this.deviceId).catch(() => {});
    this.emit({ kind: "close" });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.picked) throw new Error("Transport not open.");
    const { serviceUuid, txUuid, txWriteWithoutResponse } = this.picked;

    for (let i = 0; i < bytes.length; i += MAX_WRITE_CHUNK) {
      const slice = bytes.slice(i, i + MAX_WRITE_CHUNK);
      const dv = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
      if (txWriteWithoutResponse) {
        await BleClient.writeWithoutResponse(this.deviceId, serviceUuid, txUuid, dv);
      } else {
        await BleClient.write(this.deviceId, serviceUuid, txUuid, dv);
      }
    }
  }

  describePicked(): PickedDescription | null {
    if (!this.picked) return null;
    return {
      service: this.picked.serviceUuid,
      tx: this.picked.txUuid,
      rx: this.picked.rxUuid,
      source: this.picked.source,
    };
  }
}

function pickServiceWithFallback(services: BleService[]): Picked | null {
  // 1) Try known OBD2 service UUIDs in priority order.
  for (const wantedUuid of KNOWN_OBD_SERVICE_UUIDS) {
    const wanted = wantedUuid.toString().toLowerCase();
    const svc = services.find((s) => s.uuid.toLowerCase() === wanted);
    if (!svc) continue;
    const pair = pickFromCharacteristics(svc.characteristics ?? []);
    if (pair) return { serviceUuid: svc.uuid, ...pair, source: "known" };
  }

  // 2) Fallback: probe every service for a writable + notifiable pair.
  for (const svc of services) {
    const pair = pickFromCharacteristics(svc.characteristics ?? []);
    if (pair) return { serviceUuid: svc.uuid, ...pair, source: "fallback" };
  }

  return null;
}

type Pair = { txUuid: string; rxUuid: string; txWriteWithoutResponse: boolean };

function pickFromCharacteristics(chars: BleCharacteristic[]): Pair | null {
  const writable = chars.filter(
    (c) => c.properties.write || c.properties.writeWithoutResponse,
  );
  const notifiable = chars.filter(
    (c) => c.properties.notify || c.properties.indicate,
  );
  if (writable.length === 0 || notifiable.length === 0) return null;

  const txOnly = writable.find(
    (c) => !c.properties.notify && !c.properties.indicate,
  );
  const rxOnly = notifiable.find(
    (c) => !c.properties.write && !c.properties.writeWithoutResponse,
  );
  const tx = txOnly ?? writable[0];
  const rx = rxOnly ?? notifiable.find((c) => c.uuid !== tx.uuid) ?? notifiable[0];
  return {
    txUuid: tx.uuid,
    rxUuid: rx.uuid,
    txWriteWithoutResponse: tx.properties.writeWithoutResponse === true,
  };
}
