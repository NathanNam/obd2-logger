import { discoverStandardPids } from "./discover";
import { Elm327, type LogEntry } from "./elm327";
import { pickBleTransport } from "./pick-transport";
import type { Transport } from "./transport";
import { readVin } from "./vin";

export type ConnectionState =
  | { kind: "disconnected" }
  | { kind: "connecting"; label: string }
  | { kind: "initializing"; label: string }
  | { kind: "reading_vin"; label: string }
  | { kind: "discovering_pids"; label: string }
  | { kind: "ready"; label: string }
  | { kind: "logging"; label: string }
  | { kind: "reconnecting"; label: string; attempt: number; maxAttempts: number }
  | { kind: "error"; label: string; message: string };

export type StateListener = (state: ConnectionState) => void;

export class Connection {
  private state: ConnectionState = { kind: "disconnected" };
  private listeners = new Set<StateListener>();
  private logListeners = new Set<(e: LogEntry) => void>();
  private transport: Transport | null = null;
  private elm: Elm327 | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  onLog(listener: (e: LogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  getElm(): Elm327 | null {
    return this.elm;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const l of this.listeners) {
      try {
        l(state);
      } catch {
        // listener errors must not break the state machine
      }
    }
  }

  private logFanout(e: LogEntry) {
    for (const l of this.logListeners) {
      try {
        l(e);
      } catch {
        // ignore
      }
    }
  }

  async connect(): Promise<void> {
    if (this.state.kind !== "disconnected" && this.state.kind !== "error") {
      return;
    }
    let transport: Transport;
    try {
      this.setState({ kind: "connecting", label: "…" });
      transport = await pickBleTransport();
      this.setState({ kind: "connecting", label: transport.label });
      await transport.open();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = e instanceof DOMException && e.name === "NotFoundError";
      this.setState({
        kind: "error",
        label: "(none)",
        message: aborted ? "No adapter selected." : msg,
      });
      return;
    }

    this.transport = transport;
    const elm = new Elm327(transport);
    this.elm = elm;
    elm.attach();
    elm.onLog((e) => this.logFanout(e));

    transport.on((e) => {
      if (e.kind === "close") this.handleUnexpectedClose();
    });

    const picked = transport.describePicked?.();
    if (picked) {
      elm.log(
        "info",
        `GATT picked (${picked.source}): service=${shortUuid(picked.service)} tx=${shortUuid(picked.tx)} rx=${shortUuid(picked.rx)}`,
      );
    }

    try {
      this.setState({ kind: "initializing", label: transport.label });
      await elm.init();
      this.setState({ kind: "ready", label: transport.label });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState({ kind: "error", label: transport.label, message: msg });
      try {
        await transport.close();
      } catch {
        // ignore
      }
      this.transport = null;
      this.elm?.detach();
      this.elm = null;
    }
  }

  private reconnecting = false;

  private handleUnexpectedClose(): void {
    if (this.reconnecting) return;
    if (this.state.kind !== "ready" && this.state.kind !== "logging") return;
    if (!this.transport || !this.elm) return;
    void this.runReconnect();
  }

  private async runReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      const ok = await this.tryReconnect();
      if (!ok) {
        const label = this.transport?.label ?? "(none)";
        this.setState({
          kind: "error",
          label,
          message: "Adapter disconnected. Reconnect failed after 3 attempts.",
        });
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async tryReconnect(): Promise<boolean> {
    const transport = this.transport;
    const elm = this.elm;
    if (!transport || !elm) return false;
    const maxAttempts = 3;
    elm.log("err", "Adapter disconnected — attempting reconnect.");
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.setState({
        kind: "reconnecting",
        label: transport.label,
        attempt,
        maxAttempts,
      });
      try {
        elm.detach();
        await transport.open();
        elm.attach();
        await elm.init();
        elm.log("info", `Reconnected on attempt ${attempt}.`);
        this.setState({ kind: "ready", label: transport.label });
        return true;
      } catch (e) {
        elm.log(
          "err",
          `Reconnect attempt ${attempt}/${maxAttempts} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        if (attempt < maxAttempts) await wait(2500);
      }
    }
    return false;
  }

  async readVin(): Promise<string | null> {
    if (!this.elm) throw new Error("Not connected.");
    if (this.state.kind !== "ready") throw new Error("Connection not ready.");
    const label = this.state.label;
    this.setState({ kind: "reading_vin", label });
    try {
      const vin = await readVin(this.elm);
      this.setState({ kind: "ready", label });
      return vin;
    } catch (e) {
      this.setState({ kind: "ready", label });
      throw e;
    }
  }

  async discoverStandardPids(): Promise<string[]> {
    if (!this.elm) throw new Error("Not connected.");
    if (this.state.kind !== "ready") throw new Error("Connection not ready.");
    const label = this.state.label;
    this.setState({ kind: "discovering_pids", label });
    try {
      const pids = await discoverStandardPids(this.elm);
      this.setState({ kind: "ready", label });
      return pids;
    } catch (e) {
      this.setState({ kind: "ready", label });
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    this.elm?.detach();
    this.elm = null;
    try {
      await t?.close();
    } catch {
      // ignore
    }
    this.setState({ kind: "disconnected" });
  }
}

export const connection = new Connection();

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shortUuid(uuid: string): string {
  // The standard 16-bit UUID form is "0000XXXX-0000-1000-8000-00805f9b34fb".
  // Render as "0xXXXX" for readability, otherwise return the full UUID.
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid);
  return m ? `0x${m[1].toUpperCase()}` : uuid;
}
