import { isNative } from "../platform";
import { CapacitorStorage } from "./capacitor";
import { WebStorage } from "./web";
import type { Storage } from "./types";

export type { AppendableWriter, Entry, Storage } from "./types";
export { NotSupportedOnNativeError } from "./types";

/**
 * Build a Storage from a user-picked FileSystemDirectoryHandle. Web only —
 * native shells do not present a folder picker (see `initNativeStorage`).
 */
export function storageFromHandle(handle: FileSystemDirectoryHandle): Storage {
  return new WebStorage(handle);
}

/**
 * Build a Storage for native shells. Maps to the app's Documents directory.
 * Idempotent and synchronous; no permission prompt, no user UI.
 */
export function nativeStorage(): Storage {
  return new CapacitorStorage();
}

/**
 * True when this build should auto-initialize storage without a folder
 * picker (Capacitor shell).
 */
export function shouldAutoInitStorage(): boolean {
  return isNative();
}
