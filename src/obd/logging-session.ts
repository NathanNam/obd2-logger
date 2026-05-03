import { CsvWriter } from "../lib/csv-writer";
import {
  appendSessionRecord,
  generateSessionId,
  sessionFilename,
  type SessionRecord,
} from "../lib/sessions";
import type { Storage } from "../lib/storage";
import {
  ensureSessionsDir,
  putVehicle,
  sessionsJsonlPath,
} from "../lib/vehicles";
import { getProfile } from "../profiles/registry";
import type { Vehicle } from "../types";
import { connection } from "./connection";
import type { Elm327 } from "./elm327";
import { probeProfilePids } from "./probe";
import {
  buildRegistry,
  registryHash,
  type RegistryEntry,
} from "./registry-builder";
import { Sampler, type LiveValue, type TickRow } from "./sampler";

export type LoggingState =
  | { kind: "idle" }
  | { kind: "preparing"; step: string }
  | { kind: "logging"; rowCount: number; meanCompletionPct: number; sessionId: string }
  | { kind: "error"; message: string };

export type LoggingListener = (state: LoggingState) => void;

export type SessionPrep = {
  registry: RegistryEntry[];
  enabledColumnIds: string[];
};

export class LoggingSession {
  private state: LoggingState = { kind: "idle" };
  private listeners = new Set<LoggingListener>();
  private valueListeners = new Set<(v: LiveValue) => void>();
  private sampler: Sampler | null = null;
  private writer: CsvWriter | null = null;
  private startMs = 0;
  private startIso = "";
  private sessionId = "";
  private storage: Storage | null = null;
  private vehicle: Vehicle | null = null;
  private prep: SessionPrep | null = null;
  private currentSampleRateHz: 0.5 | 1 | 2 | 5 = 1;
  private currentRawMode = false;
  private connectionUnsub: (() => void) | null = null;

  getState(): LoggingState {
    return this.state;
  }

  onState(l: LoggingListener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  onValue(l: (v: LiveValue) => void): () => void {
    this.valueListeners.add(l);
    return () => this.valueListeners.delete(l);
  }

  private setState(s: LoggingState): void {
    this.state = s;
    for (const l of this.listeners) {
      try {
        l(s);
      } catch {
        // ignore
      }
    }
  }

  private fanoutValue(v: LiveValue): void {
    for (const l of this.valueListeners) {
      try {
        l(v);
      } catch {
        // ignore
      }
    }
  }

  async prepareForVehicle(opts: {
    storage: Storage;
    owner: string;
    vehicle: Vehicle;
    rawMode?: boolean;
  }): Promise<SessionPrep> {
    const elm = connection.getElm();
    if (!elm) throw new Error("Connection is not ready.");
    const profile = getProfile(opts.vehicle.profileId);
    if (!profile) throw new Error(`Profile '${opts.vehicle.profileId}' not found.`);

    let supportedStandard = opts.vehicle.supportedStandardPids;
    let supportedProfile = opts.vehicle.supportedProfilePids;

    // If the profile JSON on disk has a newer version than what the vehicle
    // has cached, the profile's PID set may have changed — invalidate the
    // cache so we re-probe against the new profile content.
    const profileChanged = opts.vehicle.profileVersion !== profile.profile_version;
    if (profileChanged) {
      supportedProfile = [];
    }

    if (supportedStandard.length === 0) {
      this.setState({ kind: "preparing", step: "Discovering standard PIDs…" });
      supportedStandard = await connection.discoverStandardPids();
    }

    if (opts.rawMode) {
      // Raw archaeology mode: query every profile PID regardless of decode
      // success so we capture hex bytes for every PID the ECU answers.
      // Runtime NO_DATA demotion still trims dead PIDs after 3 strikes.
      supportedProfile = profile.pids.map((p) => p.id);
    } else if (profile.pids.length > 0 && supportedProfile.length === 0) {
      this.setState({
        kind: "preparing",
        step: profileChanged
          ? `Profile updated (${opts.vehicle.profileVersion} → ${profile.profile_version}). Re-probing PIDs…`
          : "Probing profile PIDs…",
      });
      const result = await probeProfilePids(elm, profile);
      supportedProfile = result.supportedIds;
    }

    const updatedVehicle: Vehicle = {
      ...opts.vehicle,
      profileVersion: profile.profile_version,
      supportedStandardPids: supportedStandard,
      supportedProfilePids: supportedProfile,
    };
    // In raw mode the inflated profile list is for THIS run only — don't
    // overwrite the validated cache the next normal session relies on.
    if (!opts.rawMode) {
      await putVehicle(updatedVehicle);
    }

    const registry = buildRegistry({
      profile,
      supportedStandardPids: supportedStandard,
      supportedProfilePids: supportedProfile,
      vehicle: updatedVehicle,
    });
    const enabledColumnIds = registry.filter((e) => e.enabled).map((e) => e.def.id);
    this.prep = { registry, enabledColumnIds };
    this.vehicle = updatedVehicle;
    this.storage = opts.storage;
    this.setState({ kind: "idle" });
    return this.prep;
  }

  async start(opts: {
    storage: Storage;
    owner: string;
    vehicle: Vehicle;
    sampleRateHz: 0.5 | 1 | 2 | 5;
    rawMode: boolean;
  }): Promise<void> {
    if (this.state.kind === "logging" || this.state.kind === "preparing") return;
    const elm = connection.getElm();
    if (!elm) {
      this.setState({ kind: "error", message: "Connection is not ready." });
      return;
    }

    try {
      // Raw mode bypasses the cached prep so it always rebuilds the registry
      // from every profile PID (cached prep was built from the standard
      // probe which can reject PIDs that we want to keep in raw mode).
      const prep = opts.rawMode
        ? await this.prepareForVehicle({ ...opts, rawMode: true })
        : this.prep && this.vehicle?.slug === opts.vehicle.slug
          ? this.prep
          : await this.prepareForVehicle(opts);

      this.setState({ kind: "preparing", step: "Opening CSV…" });

      this.startMs = Date.now();
      this.startIso = new Date(this.startMs).toISOString();
      this.sessionId = generateSessionId();
      const filename = opts.rawMode
        ? `raw__${sessionFilename(this.startIso, this.sessionId)}`
        : sessionFilename(this.startIso, this.sessionId);

      const sessionsPath = await ensureSessionsDir(
        opts.storage,
        opts.owner,
        opts.vehicle.slug,
      );
      this.writer = await CsvWriter.create(
        opts.storage,
        `${sessionsPath}/${filename}`,
        prep.enabledColumnIds,
        {
          session_id: this.sessionId,
          vehicle_slug: opts.vehicle.slug,
          profile_id: opts.vehicle.profileId,
        },
      );

      const profile = getProfile(opts.vehicle.profileId)!;
      this.currentSampleRateHz = opts.sampleRateHz;
      this.currentRawMode = opts.rawMode;
      this.sampler = await this.startSampler({
        elm,
        profile,
        registry: prep.registry,
        sampleRateHz: opts.sampleRateHz,
        rawMode: opts.rawMode,
      });

      this.connectionUnsub = connection.onState((cs) => {
        if (this.state.kind !== "logging" && this.state.kind !== "preparing") return;
        if (cs.kind === "error" || cs.kind === "disconnected") {
          void this.stop("disconnect_timeout");
        }
      });

      this.setState({
        kind: "logging",
        rowCount: 0,
        meanCompletionPct: 100,
        sessionId: this.sessionId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState({ kind: "error", message: msg });
      await this.cleanup("error");
    }
  }

  private async startSampler(opts: {
    elm: Elm327;
    profile: Parameters<typeof buildRegistry>[0]["profile"];
    registry: RegistryEntry[];
    sampleRateHz: 0.5 | 1 | 2 | 5;
    rawMode: boolean;
  }): Promise<Sampler> {
    const sampler = new Sampler({
      elm: opts.elm,
      profile: opts.profile,
      registry: opts.registry,
      sampleRateHz: opts.sampleRateHz,
      sessionStartMs: this.startMs,
      rawMode: opts.rawMode,
    });
    sampler.onValue((v) => this.fanoutValue(v));
    sampler.onTick(async (tick: TickRow) => {
      try {
        await this.writer?.writeRow(tick.isoTimestamp, tick.elapsedMs, tick.values);
      } catch {
        // ignore individual row write errors; sampler keeps going
      }
      const rowCount = this.writer?.rows() ?? 0;
      this.setState({
        kind: "logging",
        rowCount,
        meanCompletionPct: sampler.meanCompletionPct(),
        sessionId: this.sessionId,
      });
    });
    sampler.start();
    return sampler;
  }

  async stop(reason: SessionRecord["ended_reason"] = "user_stop"): Promise<void> {
    if (this.state.kind !== "logging") {
      await this.cleanup(reason);
      return;
    }
    await this.sampler?.stop();
    await this.cleanup(reason);
  }

  private async cleanup(reason: SessionRecord["ended_reason"]): Promise<void> {
    const sampler = this.sampler;
    const writer = this.writer;
    const vehicle = this.vehicle;
    const prep = this.prep;
    const storage = this.storage;
    const startIso = this.startIso;
    const startMs = this.startMs;
    const sessionId = this.sessionId;
    const meanCompletion = sampler?.meanCompletionPct() ?? 0;

    this.sampler = null;
    this.writer = null;
    this.connectionUnsub?.();
    this.connectionUnsub = null;

    try {
      await writer?.close();
    } catch {
      // ignore
    }

    if (vehicle && prep && storage && writer) {
      try {
        const endMs = Date.now();
        const profile = getProfile(vehicle.profileId)!;
        const record: SessionRecord = {
          session_id: sessionId,
          start_utc: startIso,
          end_utc: new Date(endMs).toISOString(),
          duration_ms: endMs - startMs,
          sample_rate_hz: this.currentSampleRateHz,
          row_count: writer.rows(),
          profile_id: profile.profile_id,
          profile_version: profile.profile_version,
          registry_hash: registryHash(prep.registry),
          pid_count: prep.enabledColumnIds.length,
          file: `sessions/${this.currentRawMode ? "raw__" : ""}${sessionFilename(startIso, sessionId)}`,
          ended_reason: reason,
          mean_pid_completion_pct: meanCompletion,
          raw_mode: this.currentRawMode,
        };
        await appendSessionRecord(
          storage,
          sessionsJsonlPath(vehicle.owner, vehicle.slug),
          record,
        );
      } catch {
        // ignore session log write errors
      }
    }

    if (this.state.kind !== "error") {
      this.setState({ kind: "idle" });
    }
  }
}

export const logging = new LoggingSession();
