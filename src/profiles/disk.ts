import type { Storage } from "../lib/storage";
import { getBuiltinProfiles, setImportedProfiles } from "./registry";
import { profileToJson, validateProfile } from "./io";
import type { Profile } from "./types";

const PROFILES_DIR = "profiles";

export async function syncProfilesToDisk(
  storage: Storage,
): Promise<{ imported: Profile[] }> {
  await storage.ensureDir(PROFILES_DIR);
  const builtinIds = new Set(getBuiltinProfiles().map((p) => p.profile_id));

  for (const p of getBuiltinProfiles()) {
    await writeProfile(storage, p);
  }

  const imported: Profile[] = [];
  let entries: Awaited<ReturnType<Storage["listDir"]>>;
  try {
    entries = await storage.listDir(PROFILES_DIR);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    if (!entry.name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await storage.readText(`${PROFILES_DIR}/${entry.name}`);
    } catch {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const v = validateProfile(data);
    if (!v.ok) continue;
    if (builtinIds.has(v.profile.profile_id)) continue;
    imported.push(v.profile);
  }

  setImportedProfiles(imported);
  return { imported };
}

export async function writeProfile(
  storage: Storage,
  profile: Profile,
): Promise<void> {
  await storage.ensureDir(PROFILES_DIR);
  await storage.writeText(
    `${PROFILES_DIR}/${profile.profile_id}.json`,
    profileToJson(profile),
  );
}

export async function importProfileFromFile(
  storage: Storage,
  file: File,
): Promise<Profile> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("File is not valid JSON.");
  }
  const v = validateProfile(data);
  if (!v.ok) {
    throw new Error("Profile validation failed:\n" + v.errors.map((e) => " · " + e).join("\n"));
  }
  await writeProfile(storage, v.profile);
  await syncProfilesToDisk(storage);
  return v.profile;
}

export async function exportProfile(profile: Profile): Promise<void> {
  const blob = new Blob([profileToJson(profile)], { type: "application/json" });
  triggerDownload(blob, `${profile.profile_id}.json`);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
