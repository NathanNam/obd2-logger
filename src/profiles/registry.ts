import genericObd2 from "./builtin/generic-obd2.json";
import genericToyotaHybrid from "./builtin/generic-toyota-hybrid.json";
import lexusRx450hl2020 from "./builtin/lexus-rx450hl-2020.json";
import type { Profile } from "./types";

const BUILTIN: Profile[] = [
  genericObd2 as Profile,
  genericToyotaHybrid as Profile,
  lexusRx450hl2020 as Profile,
];

let imported: Profile[] = [];

export function getBuiltinProfiles(): Profile[] {
  return BUILTIN;
}

export function getAllProfiles(): Profile[] {
  return [...BUILTIN, ...imported];
}

export function setImportedProfiles(profiles: Profile[]): void {
  imported = profiles;
}

export function getProfile(id: string): Profile | undefined {
  return getAllProfiles().find((p) => p.profile_id === id);
}

export function suggestProfileFor(opts: {
  make?: string;
  model?: string;
  year?: number | null;
}): Profile {
  const make = (opts.make ?? "").toLowerCase();
  const model = (opts.model ?? "").toLowerCase();
  const year = opts.year ?? undefined;

  const profiles = getAllProfiles();
  const exact = profiles.find((p) => {
    const m = p.vehicle_match;
    if (!m) return false;
    const mm = (m.make ?? "").toLowerCase();
    if (mm && mm !== make) return false;
    if (m.models && m.models.length) {
      const hit = m.models.some((x) => model.includes(x.toLowerCase()));
      if (!hit) return false;
    }
    if (year !== undefined) {
      if (m.year_min !== undefined && year < m.year_min) return false;
      if (m.year_max !== undefined && year > m.year_max) return false;
    }
    return true;
  });
  if (exact) return exact;

  if (make === "toyota" || make === "lexus") {
    const hybrid = profiles.find((p) => p.profile_id === "generic-toyota-hybrid");
    if (hybrid) return hybrid;
  }

  return BUILTIN[0];
}
