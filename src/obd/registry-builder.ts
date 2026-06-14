import type { PidDef } from "../profiles/types";
import type { Profile } from "../profiles/types";
import type { Vehicle } from "../types";
import { getStandardPid } from "./standard-pids";

export type RegistryEntry = {
  def: PidDef;
  source: "standard" | "profile" | "custom";
  enabled: boolean;
};

const CATEGORY_ORDER: Record<string, number> = {
  engine: 0,
  hybrid: 1,
  battery: 2,
  transmission: 3,
  emissions: 4,
  diagnostics: 5,
  other: 6,
};

// Mode-01 PIDs whose response is itself a "which PIDs do you support" bitmask.
// They're discovery metadata, not telemetry — never query them as data even
// when the ECU reports they're supported.
const BITMASK_PIDS = new Set(["00", "20", "40", "60", "80", "A0", "C0"]);

export function buildRegistry(opts: {
  profile: Profile;
  supportedStandardPids: string[];
  supportedProfilePids: string[];
  vehicle: Vehicle;
}): RegistryEntry[] {
  const { profile, supportedStandardPids, supportedProfilePids, vehicle } = opts;
  const disabled = new Set(vehicle.disabledPids);
  const entries: RegistryEntry[] = [];

  const seenIds = new Set<string>();
  for (const pid of supportedStandardPids) {
    if (BITMASK_PIDS.has(pid.toUpperCase())) continue;
    const def = getStandardPid(pid);
    if (!def) continue;
    entries.push({ def, source: "standard", enabled: !disabled.has(def.id) });
    seenIds.add(def.id);
  }

  // Dedupe by id: profile PIDs that redeclare a standard PID (e.g. an `rpm`
  // placeholder added to satisfy the iOS importer's non-empty-pids check) get
  // dropped here. Otherwise the CSV ends up with two identically named columns
  // and downstream readers silently take whichever pandas/csv parses last.
  for (const pid of profile.pids) {
    if (!supportedProfilePids.includes(pid.id)) continue;
    if (seenIds.has(pid.id)) continue;
    entries.push({ def: pid, source: "profile", enabled: !disabled.has(pid.id) });
    seenIds.add(pid.id);
  }

  return entries.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.def.category] ?? 99;
    const cb = CATEGORY_ORDER[b.def.category] ?? 99;
    if (ca !== cb) return ca - cb;
    if (a.def.ecu !== b.def.ecu) return a.def.ecu.localeCompare(b.def.ecu);
    return a.def.id.localeCompare(b.def.id);
  });
}

export function groupByEcu(entries: RegistryEntry[]): Map<string, RegistryEntry[]> {
  const out = new Map<string, RegistryEntry[]>();
  for (const e of entries) {
    if (!e.enabled) continue;
    const list = out.get(e.def.ecu) ?? [];
    list.push(e);
    out.set(e.def.ecu, list);
  }
  return out;
}

export function registryHash(entries: RegistryEntry[]): string {
  const ids = entries.filter((e) => e.enabled).map((e) => e.def.id).sort();
  let h = 0;
  for (const id of ids.join(",")) {
    h = (h * 31 + id.charCodeAt(0)) | 0;
  }
  return "fnv-" + (h >>> 0).toString(16);
}
