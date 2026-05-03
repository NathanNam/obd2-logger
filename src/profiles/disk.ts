import { getBuiltinProfiles, setImportedProfiles } from "./registry";
import { profileToJson, validateProfile } from "./io";
import type { Profile } from "./types";

async function ensureProfilesDir(
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle("profiles", { create: true });
}

export async function syncProfilesToDisk(
  root: FileSystemDirectoryHandle,
): Promise<{ imported: Profile[] }> {
  const profilesDir = await ensureProfilesDir(root);
  const builtinIds = new Set(getBuiltinProfiles().map((p) => p.profile_id));

  for (const p of getBuiltinProfiles()) {
    await writeProfile(profilesDir, p);
  }

  const imported: Profile[] = [];
  for await (const entry of profilesDir.values()) {
    if (entry.kind !== "file") continue;
    if (!entry.name.endsWith(".json")) continue;
    const f = await (entry as FileSystemFileHandle).getFile();
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
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
  profilesDir: FileSystemDirectoryHandle,
  profile: Profile,
): Promise<void> {
  const filename = profile.profile_id + ".json";
  const handle = await profilesDir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(profileToJson(profile));
  await writable.close();
}

export async function importProfileFromFile(
  root: FileSystemDirectoryHandle,
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
  const profilesDir = await ensureProfilesDir(root);
  await writeProfile(profilesDir, v.profile);
  await syncProfilesToDisk(root);
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
