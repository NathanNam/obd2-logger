import { openDB, type IDBPDatabase } from "idb";
import type { Vehicle } from "../types";

const DB_NAME = "obd2-logger";

async function getDB(): Promise<IDBPDatabase<unknown>> {
  return openDB(DB_NAME, 1);
}

export async function listVehicles(owner: string): Promise<Vehicle[]> {
  const db = await getDB();
  const tx = db.transaction("vehicles", "readonly");
  const idx = tx.store.index("by-owner");
  const all = (await idx.getAll(IDBKeyRange.only(owner))) as Vehicle[];
  await tx.done;
  return all.sort((a, b) =>
    (b.lastUsedUtc ?? b.createdAtUtc).localeCompare(a.lastUsedUtc ?? a.createdAtUtc),
  );
}

export async function getVehicle(slug: string): Promise<Vehicle | null> {
  const db = await getDB();
  return ((await db.get("vehicles", slug)) as Vehicle | undefined) ?? null;
}

export async function putVehicle(v: Vehicle): Promise<void> {
  const db = await getDB();
  await db.put("vehicles", v);
}

export async function deleteVehicle(slug: string): Promise<void> {
  const db = await getDB();
  await db.delete("vehicles", slug);
}

export function buildSlug(opts: { year?: number | null; make?: string; model?: string }): string {
  const parts: string[] = [];
  if (opts.year && Number.isFinite(opts.year)) parts.push(String(opts.year));
  if (opts.make) parts.push(opts.make);
  if (opts.model) parts.push(opts.model);
  const joined = parts.join("-");
  return joined
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildDisplayName(opts: {
  year?: number | null;
  make?: string;
  model?: string;
  trim?: string;
}): string {
  const parts: string[] = [];
  if (opts.year && Number.isFinite(opts.year)) parts.push(String(opts.year));
  if (opts.make) parts.push(opts.make);
  if (opts.model) parts.push(opts.model);
  if (opts.trim) parts.push(opts.trim);
  return parts.join(" ").trim();
}

export type VehicleJsonPayload = Omit<Vehicle, "owner"> & {
  owner: string;
  vin_decoded?: {
    source: "nhtsa_vpic";
    decoded_at_utc: string;
    raw_response_excerpt: Record<string, string | null>;
  };
  vin_decode_skipped?: boolean;
};

export async function writeVehicleJson(
  ownerDir: FileSystemDirectoryHandle,
  vehicle: Vehicle,
  decoded?: VehicleJsonPayload["vin_decoded"],
  skipped?: boolean,
): Promise<void> {
  const slugDir = await ownerDir.getDirectoryHandle(vehicle.slug, { create: true });
  const fileHandle = await slugDir.getFileHandle("vehicle.json", { create: true });
  const writable = await fileHandle.createWritable();
  const payload: VehicleJsonPayload = {
    ...vehicle,
    ...(decoded ? { vin_decoded: decoded } : {}),
    ...(skipped !== undefined ? { vin_decode_skipped: skipped } : {}),
  };
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

export async function ensureSessionsDir(
  ownerDir: FileSystemDirectoryHandle,
  slug: string,
): Promise<FileSystemDirectoryHandle> {
  const slugDir = await ownerDir.getDirectoryHandle(slug, { create: true });
  return slugDir.getDirectoryHandle("sessions", { create: true });
}
