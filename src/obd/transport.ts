export type TransportEvent =
  | { kind: "open" }
  | { kind: "close"; reason?: string }
  | { kind: "data"; bytes: Uint8Array }
  | { kind: "error"; message: string };

export type TransportListener = (e: TransportEvent) => void;

export interface Transport {
  readonly id: string;
  readonly label: string;
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  on(listener: TransportListener): () => void;
  isOpen(): boolean;
}

export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

export function bytesToAscii(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}
