import {
  buildRequestDeviceOptions,
  KNOWN_OBD_SERVICE_UUIDS,
} from "./adapters";
import {
  type Transport,
  type TransportEvent,
  type TransportListener,
} from "./transport";

const MAX_WRITE_CHUNK = 20;

type Picked = {
  service: BluetoothRemoteGATTService;
  tx: BluetoothRemoteGATTCharacteristic;
  rx: BluetoothRemoteGATTCharacteristic;
  source: "known" | "fallback";
};

export class BleTransport implements Transport {
  readonly id = "ble";
  readonly label: string;

  private listeners = new Set<TransportListener>();
  private device: BluetoothDevice | null = null;
  private picked: Picked | null = null;
  private opened = false;
  private disconnectListenerAttached = false;

  constructor(device: BluetoothDevice) {
    this.device = device;
    this.label = device.name ?? "(unnamed BLE device)";
  }

  static async pick(): Promise<BleTransport> {
    const dev = await navigator.bluetooth.requestDevice(buildRequestDeviceOptions());
    return new BleTransport(dev);
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
    if (!this.device) throw new Error("No device.");
    if (!this.device.gatt) throw new Error("Device has no GATT.");

    const server = this.device.gatt.connected
      ? this.device.gatt
      : await this.device.gatt.connect();

    this.picked = await pickServiceWithFallback(server);

    await subscribeNotifications(this.picked.rx, (bytes) =>
      this.emit({ kind: "data", bytes }),
    );

    if (!this.disconnectListenerAttached) {
      this.device.addEventListener("gattserverdisconnected", () => {
        this.opened = false;
        this.emit({ kind: "close", reason: "GATT disconnected" });
      });
      this.disconnectListenerAttached = true;
    }

    this.opened = true;
    this.emit({ kind: "open" });
  }

  async close(): Promise<void> {
    this.opened = false;
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // ignore
    }
    this.emit({ kind: "close" });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.picked) throw new Error("Transport not open.");
    const { tx } = this.picked;
    const preferNoResponse = tx.properties.writeWithoutResponse;

    for (let i = 0; i < bytes.length; i += MAX_WRITE_CHUNK) {
      const slice = bytes.slice(i, i + MAX_WRITE_CHUNK);
      if (preferNoResponse) {
        await tx.writeValueWithoutResponse(slice);
      } else {
        await tx.writeValueWithResponse(slice);
      }
    }
  }

  describePicked(): { service: string; tx: string; rx: string; source: string } | null {
    if (!this.picked) return null;
    return {
      service: this.picked.service.uuid,
      tx: this.picked.tx.uuid,
      rx: this.picked.rx.uuid,
      source: this.picked.source,
    };
  }
}

async function pickServiceWithFallback(
  server: BluetoothRemoteGATTServer,
): Promise<Picked> {
  // 1) Try known OBD2 service UUIDs in priority order.
  for (const uuid of KNOWN_OBD_SERVICE_UUIDS) {
    try {
      const service = await server.getPrimaryService(uuid);
      const chars = await service.getCharacteristics();
      const pair = pickFromCharacteristics(chars);
      if (pair) {
        return { service, ...pair, source: "known" };
      }
    } catch {
      // service not present; try next
    }
  }

  // 2) Fallback: enumerate every primary service and probe for a tx/rx pair.
  //    This is what saves us when an adapter's firmware uses unexpected UUIDs.
  let services: BluetoothRemoteGATTService[];
  try {
    services = await server.getPrimaryServices();
  } catch (e) {
    throw new Error(
      `Could not read GATT services on this adapter: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  for (const service of services) {
    try {
      const chars = await service.getCharacteristics();
      const pair = pickFromCharacteristics(chars);
      if (pair) {
        return { service, ...pair, source: "fallback" };
      }
    } catch {
      // skip services we can't read
    }
  }

  throw new Error(
    "No BLE service on this adapter exposes the writable + notifiable characteristics needed for ELM327 communication. Check the adapter's manual for required services / pairing PIN, or try a different adapter.",
  );
}

function pickFromCharacteristics(
  chars: BluetoothRemoteGATTCharacteristic[],
): { tx: BluetoothRemoteGATTCharacteristic; rx: BluetoothRemoteGATTCharacteristic } | null {
  const writable = chars.filter(
    (c) => c.properties.write || c.properties.writeWithoutResponse,
  );
  const notifiable = chars.filter(
    (c) => c.properties.notify || c.properties.indicate,
  );
  if (writable.length === 0 || notifiable.length === 0) return null;

  // Prefer a tx-only writer and an rx-only notifier so we don't mix paths
  // through a single characteristic when distinct ones exist. Falls back to
  // the first available of each, ensuring tx and rx are different characteristics
  // when possible.
  const txOnly = writable.find(
    (c) => !c.properties.notify && !c.properties.indicate,
  );
  const rxOnly = notifiable.find(
    (c) => !c.properties.write && !c.properties.writeWithoutResponse,
  );
  const tx = txOnly ?? writable[0];
  const rx = rxOnly ?? notifiable.find((c) => c.uuid !== tx.uuid) ?? notifiable[0];
  return { tx, rx };
}

async function subscribeNotifications(
  rx: BluetoothRemoteGATTCharacteristic,
  onBytes: (b: Uint8Array) => void,
): Promise<void> {
  rx.addEventListener("characteristicvaluechanged", (ev) => {
    const target = ev.target as BluetoothRemoteGATTCharacteristic;
    const v = target.value;
    if (!v) return;
    onBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  });
  await rx.startNotifications();
}
