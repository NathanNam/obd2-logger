import {
  asciiBytes,
  bytesToAscii,
  type Transport,
  type TransportEvent,
} from "./transport";

export type ElmError =
  | "NO_DATA"
  | "QUESTION"
  | "STOPPED"
  | "BUFFER_FULL"
  | "CAN_ERROR"
  | "UNABLE_TO_CONNECT"
  | "BUS_INIT"
  | "TIMEOUT";

export type ElmResponse = {
  lines: string[];
  raw: string;
  errors: ElmError[];
};

export type LogEntry = {
  ts: number;
  direction: "tx" | "rx" | "info" | "err";
  text: string;
};

export type LogListener = (entry: LogEntry) => void;

const PROMPT = ">";

type Pending = {
  cmd: string;
  timeoutMs: number;
  resolve: (r: ElmResponse) => void;
  reject: (err: Error) => void;
  start: number;
};

export class Elm327 {
  private buf = "";
  private inflight: Pending | null = null;
  private queue: Pending[] = [];
  private logListeners = new Set<LogListener>();
  private removeTransportListener: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  attach(): void {
    if (this.removeTransportListener) return;
    this.removeTransportListener = this.transport.on((e) => this.onEvent(e));
  }

  detach(): void {
    this.removeTransportListener?.();
    this.removeTransportListener = null;
    this.failAll(new Error("Detached."));
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  log(direction: LogEntry["direction"], text: string): void {
    const entry: LogEntry = { ts: Date.now(), direction, text };
    for (const l of this.logListeners) {
      try {
        l(entry);
      } catch {
        // listener errors must not break parsing
      }
    }
  }

  async send(cmd: string, opts?: { timeoutMs?: number }): Promise<ElmResponse> {
    const trimmed = cmd.trim();
    if (!trimmed) throw new Error("Empty command.");
    return new Promise<ElmResponse>((resolve, reject) => {
      const pending: Pending = {
        cmd: trimmed,
        timeoutMs: opts?.timeoutMs ?? 4000,
        resolve,
        reject,
        start: 0,
      };
      this.queue.push(pending);
      void this.pump();
    });
  }

  async init(): Promise<void> {
    // ATZ resets the adapter; some firmware needs a settling pause before it
    // accepts the next command. Same approach the obd2-scanner uses on real
    // hardware. Empty/garbage response to ATZ is non-fatal.
    const atz = await this.send("ATZ", { timeoutMs: 6000 });
    this.log("info", `ATZ → ${atz.lines.join(" | ") || "(no lines)"}`);
    await wait(800);

    const rest = ["ATE0", "ATL0", "ATS0", "ATH0", "ATSP0", "ATCAF1"];
    for (const cmd of rest) {
      const res = await this.send(cmd);
      this.log("info", `${cmd} → ${res.lines.join(" | ") || "(no lines)"}`);
      await wait(120);
    }
  }

  private async pump(): Promise<void> {
    if (this.inflight || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.inflight = next;
    next.start = Date.now();
    this.buf = "";
    this.log("tx", next.cmd);
    try {
      await this.transport.write(asciiBytes(next.cmd + "\r"));
    } catch (e) {
      this.inflight = null;
      next.reject(e instanceof Error ? e : new Error(String(e)));
      void this.pump();
      return;
    }
    this.timer = setTimeout(() => {
      if (!this.inflight) return;
      const p = this.inflight;
      this.inflight = null;
      this.timer = null;
      this.log("err", `timeout: ${p.cmd}`);
      p.resolve({ lines: [], raw: this.buf, errors: ["TIMEOUT"] });
      this.buf = "";
      void this.pump();
    }, next.timeoutMs);
  }

  private onEvent(e: TransportEvent): void {
    if (e.kind === "data") {
      this.buf += bytesToAscii(e.bytes);
      this.tryComplete();
      return;
    }
    if (e.kind === "close") {
      this.failAll(new Error("Transport closed."));
      return;
    }
    if (e.kind === "error") {
      this.failAll(new Error(e.message));
      return;
    }
  }

  private tryComplete(): void {
    if (!this.inflight) return;
    const promptIdx = this.buf.indexOf(PROMPT);
    if (promptIdx === -1) return;

    const chunk = this.buf.slice(0, promptIdx);
    this.buf = this.buf.slice(promptIdx + 1);

    const pending = this.inflight;
    this.inflight = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const response = parseResponse(chunk, pending.cmd);
    this.log("rx", response.lines.join(" | ") || "(empty)");
    pending.resolve(response);
    void this.pump();
  }

  private failAll(err: Error): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight) {
      this.inflight.reject(err);
      this.inflight = null;
    }
    while (this.queue.length) {
      const p = this.queue.shift()!;
      p.reject(err);
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseResponse(raw: string, command: string): ElmResponse {
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => l !== command.trim());

  const errors: ElmError[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "NO DATA") errors.push("NO_DATA");
    else if (upper === "?") errors.push("QUESTION");
    else if (upper === "STOPPED") errors.push("STOPPED");
    else if (upper === "BUFFER FULL") errors.push("BUFFER_FULL");
    else if (upper.startsWith("CAN ERROR")) errors.push("CAN_ERROR");
    else if (upper.startsWith("UNABLE TO CONNECT")) errors.push("UNABLE_TO_CONNECT");
    else if (upper.startsWith("BUS INIT")) errors.push("BUS_INIT");
    else kept.push(line);
  }

  return { lines: kept, raw, errors };
}
