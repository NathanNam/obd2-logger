import type { PidCategory, Profile } from "./types";

const VALID_CATEGORIES: PidCategory[] = [
  "engine", "hybrid", "battery", "transmission", "emissions", "diagnostics", "other",
];

export type ValidationResult =
  | { ok: true; profile: Profile }
  | { ok: false; errors: string[] };

export function validateProfile(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["Profile must be a JSON object."] };
  }
  const obj = input as Record<string, unknown>;

  const requireString = (k: string): string => {
    const v = obj[k];
    if (typeof v !== "string" || !v) {
      errors.push(`Field '${k}' is required (string).`);
      return "";
    }
    return v;
  };

  const profile_id = requireString("profile_id");
  const profile_version = requireString("profile_version");
  const display_name = requireString("display_name");
  const description = typeof obj.description === "string" ? obj.description : "";

  const ecusRaw = obj.ecus;
  const ecus: Profile["ecus"] = {};
  if (!ecusRaw || typeof ecusRaw !== "object") {
    errors.push("Field 'ecus' is required (object).");
  } else {
    for (const [name, def] of Object.entries(ecusRaw as Record<string, unknown>)) {
      if (!def || typeof def !== "object") {
        errors.push(`ECU '${name}' must be an object.`);
        continue;
      }
      const d = def as Record<string, unknown>;
      const req = typeof d.request_header === "string" ? d.request_header : "";
      const resp = typeof d.response_header === "string" ? d.response_header : "";
      if (!/^[0-9A-Fa-f]{3,}$/.test(req)) errors.push(`ECU '${name}' request_header must be hex.`);
      if (!/^[0-9A-Fa-f]{3,}$/.test(resp)) errors.push(`ECU '${name}' response_header must be hex.`);
      ecus[name] = { request_header: req.toUpperCase(), response_header: resp.toUpperCase() };
    }
  }

  const pidsRaw = obj.pids;
  const pids: Profile["pids"] = [];
  if (!Array.isArray(pidsRaw)) {
    errors.push("Field 'pids' is required (array).");
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < pidsRaw.length; i++) {
      const item = pidsRaw[i];
      if (!item || typeof item !== "object") {
        errors.push(`pids[${i}] must be an object.`);
        continue;
      }
      const p = item as Record<string, unknown>;
      const id = typeof p.id === "string" ? p.id : "";
      const display = typeof p.display_name === "string" ? p.display_name : "";
      const ecu = typeof p.ecu === "string" ? p.ecu : "";
      const mode = typeof p.mode === "string" ? p.mode.toUpperCase() : "";
      const pidHex = typeof p.pid === "string" ? p.pid.toUpperCase() : "";
      const unit = typeof p.unit === "string" ? p.unit : "";
      const formula = typeof p.formula === "string" ? p.formula : "";
      const cat = typeof p.category === "string" ? (p.category as PidCategory) : "other";
      if (!id) errors.push(`pids[${i}].id is required.`);
      if (seen.has(id)) errors.push(`pids[${i}].id '${id}' is duplicated.`);
      seen.add(id);
      if (!display) errors.push(`pids[${i}].display_name is required.`);
      if (!ecu || !ecus[ecu]) errors.push(`pids[${i}].ecu '${ecu}' must reference a defined ECU.`);
      if (!/^[0-9A-F]{2}$/.test(mode)) errors.push(`pids[${i}].mode must be a 2-char hex.`);
      if (!/^[0-9A-F]{2,}$/.test(pidHex)) errors.push(`pids[${i}].pid must be hex.`);
      if (!formula) errors.push(`pids[${i}].formula is required.`);
      if (!VALID_CATEGORIES.includes(cat))
        errors.push(`pids[${i}].category '${cat}' is invalid.`);
      pids.push({
        id, display_name: display, ecu, mode, pid: pidHex,
        unit, formula, category: cat,
        min: typeof p.min === "number" ? p.min : undefined,
        max: typeof p.max === "number" ? p.max : undefined,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const profile: Profile = {
    profile_id, profile_version, display_name, description, ecus, pids,
    vehicle_match: typeof obj.vehicle_match === "object" && obj.vehicle_match !== null
      ? (obj.vehicle_match as Profile["vehicle_match"])
      : undefined,
    sources: Array.isArray(obj.sources) ? (obj.sources as string[]) : undefined,
    validated_against: Array.isArray(obj.validated_against)
      ? (obj.validated_against as Profile["validated_against"])
      : undefined,
  };
  return { ok: true, profile };
}

export function profileToJson(profile: Profile): string {
  return JSON.stringify(profile, null, 2) + "\n";
}
