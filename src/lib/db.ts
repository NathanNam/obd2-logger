import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_SETTINGS, type Settings, type Vehicle } from "../types";

const DB_NAME = "obd2-logger";
const DB_VERSION = 1;

const SETTINGS_KEY = "singleton";
const DIR_HANDLE_KEY = "root";

interface LoggerDB extends DBSchema {
  settings: {
    key: string;
    value: Settings;
  };
  handles: {
    key: string;
    value: FileSystemDirectoryHandle;
  };
  vehicles: {
    key: string;
    value: Vehicle;
    indexes: { "by-owner": string };
  };
  profiles: {
    key: string;
    value: { id: string; json: unknown; importedAtUtc: string };
  };
}

let dbPromise: Promise<IDBPDatabase<LoggerDB>> | null = null;

function getDB(): Promise<IDBPDatabase<LoggerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LoggerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
        if (!db.objectStoreNames.contains("handles")) {
          db.createObjectStore("handles");
        }
        if (!db.objectStoreNames.contains("vehicles")) {
          const vehicles = db.createObjectStore("vehicles", { keyPath: "slug" });
          vehicles.createIndex("by-owner", "owner");
        }
        if (!db.objectStoreNames.contains("profiles")) {
          db.createObjectStore("profiles", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadSettings(): Promise<Settings> {
  const db = await getDB();
  const stored = await db.get("settings", SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  await db.put("settings", settings, SETTINGS_KEY);
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  return next;
}

export async function getRootDirHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await getDB();
  return db.get("handles", DIR_HANDLE_KEY);
}

export async function setRootDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDB();
  await db.put("handles", handle, DIR_HANDLE_KEY);
}

export async function clearRootDirHandle(): Promise<void> {
  const db = await getDB();
  await db.delete("handles", DIR_HANDLE_KEY);
}
