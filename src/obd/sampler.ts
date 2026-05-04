import type { Profile } from "../profiles/types";
import type { Elm327 } from "./elm327";
import { decodePidResponse, buildCommand } from "./pid-codec";
import {
  groupByEcu,
  type RegistryEntry,
} from "./registry-builder";

const NO_DATA_STRIKES_TO_DEMOTE = 3;
// Periodically un-demote silent PIDs so we re-detect ones that come back
// online — critical for hybrids where ICE-only PIDs go silent in EV mode
// and would otherwise stay demoted for the whole drive.
const REHAB_EVERY_N_TICKS = 30;

export type TickRow = {
  tickStart: number;
  isoTimestamp: string;
  elapsedMs: number;
  values: Record<string, number | string | null>;
  rawHex: Record<string, string>;
  completedCount: number;
  enabledCount: number;
};

export type LiveValue = {
  id: string;
  value: number;
  isoTimestamp: string;
};

export type TickListener = (tick: TickRow) => void;
export type ValueListener = (v: LiveValue) => void;
export type StateListener = (state: SamplerState) => void;

export type SamplerState =
  | { kind: "idle" }
  | { kind: "running"; tickCount: number; meanCompletionPct: number }
  | { kind: "stopping" };

export type SamplerOpts = {
  elm: Elm327;
  profile: Profile;
  registry: RegistryEntry[];
  sampleRateHz: 0.5 | 1 | 2 | 5;
  sessionStartMs: number;
  rawMode: boolean;
};

export class Sampler {
  private opts: SamplerOpts;
  private running = false;
  private state: SamplerState = { kind: "idle" };
  private tickListeners = new Set<TickListener>();
  private valueListeners = new Set<ValueListener>();
  private stateListeners = new Set<StateListener>();
  private demoted = new Set<string>();
  private noDataStreaks = new Map<string, number>();
  private tickCount = 0;
  private completionSum = 0;

  constructor(opts: SamplerOpts) {
    this.opts = opts;
  }

  onTick(l: TickListener): () => void {
    this.tickListeners.add(l);
    return () => this.tickListeners.delete(l);
  }
  onValue(l: ValueListener): () => void {
    this.valueListeners.add(l);
    return () => this.valueListeners.delete(l);
  }
  onState(l: StateListener): () => void {
    this.stateListeners.add(l);
    l(this.state);
    return () => this.stateListeners.delete(l);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.completionSum = 0;
    this.demoted.clear();
    this.noDataStreaks.clear();
    this.setState({ kind: "running", tickCount: 0, meanCompletionPct: 0 });
    void this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.setState({ kind: "stopping" });
    await new Promise<void>((resolve) => {
      const off = this.onState((s) => {
        if (s.kind === "idle") {
          off();
          resolve();
        }
      });
    });
  }

  meanCompletionPct(): number {
    return this.tickCount === 0 ? 0 : this.completionSum / this.tickCount;
  }

  private setState(s: SamplerState): void {
    this.state = s;
    for (const l of this.stateListeners) {
      try {
        l(s);
      } catch {
        // ignore
      }
    }
  }

  private async loop(): Promise<void> {
    const intervalMs = Math.round(1000 / this.opts.sampleRateHz);
    while (this.running) {
      const tickStart = Date.now();
      const row = await this.runTick(tickStart);
      this.tickCount++;
      const pct = row.enabledCount === 0 ? 100 : (row.completedCount * 100) / row.enabledCount;
      this.completionSum += pct;
      for (const l of this.tickListeners) {
        try {
          l(row);
        } catch {
          // ignore listener errors
        }
      }
      this.setState({
        kind: "running",
        tickCount: this.tickCount,
        meanCompletionPct: this.completionSum / this.tickCount,
      });
      const elapsed = Date.now() - tickStart;
      const sleepMs = Math.max(0, intervalMs - elapsed);
      if (sleepMs > 0) await wait(sleepMs);
    }
    this.setState({ kind: "idle" });
  }

  private async runTick(tickStart: number): Promise<TickRow> {
    const isoTimestamp = new Date(tickStart).toISOString();
    const elapsedMs = tickStart - this.opts.sessionStartMs;
    const values: Record<string, number | string | null> = {};
    const rawHex: Record<string, string> = {};
    const rawMode = this.opts.rawMode;
    let completedCount = 0;
    let enabledCount = 0;

    // Strike rehab: every N ticks, give demoted PIDs another shot.
    // Anything still silent will re-demote within ~3 ticks.
    if (this.tickCount > 0 && this.tickCount % REHAB_EVERY_N_TICKS === 0 && this.demoted.size > 0) {
      this.demoted.clear();
      this.noDataStreaks.clear();
    }

    const groups = groupByEcu(
      this.opts.registry.filter((e) => e.enabled && !this.demoted.has(e.def.id)),
    );

    for (const [, entries] of groups) {
      enabledCount += entries.length;
    }
    // Account for already-demoted-but-still-enabled entries in row width.
    for (const e of this.opts.registry) {
      if (e.enabled && this.demoted.has(e.def.id)) {
        values[e.def.id] = null;
      }
    }

    for (const [, entries] of groups) {
      if (!this.running) break;
      const ecu = this.opts.profile.ecus[entries[0].def.ecu];
      if (ecu) {
        await this.opts.elm.send(`ATSH${ecu.request_header}`, { timeoutMs: 800 }).catch(() => null);
      }
      // Dedupe identical (mode, pid) queries within the group: e.g.
      // battery_temp_1..4 all read different bytes from the same PID 95
      // response. One query, four formulas. Faster + avoids tripping
      // adapter rate-limits on rapid-fire identical queries.
      for (const queryGroup of dedupeByQuery(entries)) {
        if (!this.running) break;
        const cmd = buildCommand(queryGroup[0].def);
        let resp;
        try {
          resp = await this.opts.elm.send(cmd, { timeoutMs: 1200 });
        } catch {
          for (const entry of queryGroup) values[entry.def.id] = null;
          continue;
        }
        if (resp.errors.includes("NO_DATA")) {
          for (const entry of queryGroup) {
            this.bumpNoData(entry.def.id);
            values[entry.def.id] = null;
          }
          continue;
        }
        if (resp.errors.length) {
          for (const entry of queryGroup) values[entry.def.id] = null;
          continue;
        }
        for (const entry of queryGroup) {
          const outcome = decodePidResponse(entry.def, resp.lines);
          const hex = outcome.rawBytes
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
          if (rawMode) {
            if (hex.length > 0) {
              values[entry.def.id] = hex;
              rawHex[entry.def.id] = hex;
              completedCount++;
              this.noDataStreaks.delete(entry.def.id);
            } else {
              values[entry.def.id] = null;
            }
          } else if (outcome.ok) {
            values[entry.def.id] = outcome.value;
            rawHex[entry.def.id] = hex;
            completedCount++;
            this.noDataStreaks.delete(entry.def.id);
            for (const l of this.valueListeners) {
              try {
                l({ id: entry.def.id, value: outcome.value, isoTimestamp });
              } catch {
                // ignore
              }
            }
          } else {
            values[entry.def.id] = null;
            // Treat the all-FF sentinel as a silence vote — it means
            // "supported but no data right now," not a real reading.
            if (outcome.reason === "all-FF-sentinel") {
              this.bumpNoData(entry.def.id);
            }
          }
        }
      }
    }

    return {
      tickStart,
      isoTimestamp,
      elapsedMs,
      values,
      rawHex,
      completedCount,
      enabledCount,
    };
  }


  private bumpNoData(id: string): void {
    const next = (this.noDataStreaks.get(id) ?? 0) + 1;
    this.noDataStreaks.set(id, next);
    if (next >= NO_DATA_STRIKES_TO_DEMOTE) this.demoted.add(id);
  }
}

/// Group entries that share a (mode, pid) query, preserving first-seen
/// order. Multiple PidDefs reading different bytes from the same response
/// (e.g. battery_temp_1..4 from PID 95) are batched so we send the query
/// once per tick instead of once per def.
function dedupeByQuery(entries: RegistryEntry[]): RegistryEntry[][] {
  const order: string[] = [];
  const groups = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.def.mode}${entry.def.pid}`.toUpperCase();
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
      order.push(key);
    }
  }
  return order.map((k) => groups.get(k)!);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
