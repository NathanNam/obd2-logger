/**
 * Path-based storage abstraction. Each implementation hides the platform's
 * file API: WebStorage wraps a FileSystemDirectoryHandle (File System Access),
 * CapacitorStorage wraps Capacitor Filesystem (iOS / Android sandbox).
 *
 * Paths are forward-slash separated, relative to the storage root.
 * E.g. "data/nathan/2020-lexus-rx/sessions/2026-05-02T17-23-09Z__a3f9k2lp.csv"
 */

export type Entry = { name: string; kind: "file" | "directory" };

export interface AppendableWriter {
  /** Append text. Persistence policy is implementation-defined. */
  write(text: string): Promise<void>;
  /** Flush any in-memory buffer to disk. */
  flush(): Promise<void>;
  /** Flush and release resources. After close, write/flush are no-ops. */
  close(): Promise<void>;
}

export interface Storage {
  /** Human-readable label for the root, used in UI. */
  readonly label: string;

  /** Whether the storage is initialized and writable. */
  isReady(): boolean;

  /**
   * Idempotently create the directory at `path`, including any missing
   * parents. No-op if it already exists.
   */
  ensureDir(path: string): Promise<void>;

  /** True if a file or directory exists at `path`. */
  exists(path: string): Promise<boolean>;

  /** Read a UTF-8 text file at `path`. Throws if the file doesn't exist. */
  readText(path: string): Promise<string>;

  /**
   * Write `content` to `path`, creating the file (and parent dirs) if needed.
   * Overwrites existing content.
   */
  writeText(path: string, content: string): Promise<void>;

  /**
   * Append `content` to `path`, creating the file (and parent dirs) if needed.
   * Equivalent to `readText(p) + content` then `writeText`, but may use a
   * native append on Capacitor to avoid full-file reads.
   */
  appendText(path: string, content: string): Promise<void>;

  /** Remove the file at `path`. No-op if it doesn't exist. */
  removeFile(path: string): Promise<void>;

  /** List entries in the directory at `path`. Throws if the dir doesn't exist. */
  listDir(path: string): Promise<Entry[]>;

  /**
   * Open a high-frequency append writer for `path`. Used by the CSV writer,
   * which streams ~1 row/sec for the duration of a logging session.
   *
   * If `append` is true and the file exists, writes are appended; otherwise
   * existing content is truncated.
   */
  openWriter(path: string, opts?: { append?: boolean }): Promise<AppendableWriter>;

  /**
   * Escape hatch: returns the underlying `FileSystemDirectoryHandle` on web,
   * throws on native. Used by code paths not yet refactored to the path-based
   * API (JSZip export, sweep panel writes, profile import). Calling this on
   * native is the documented signal that the feature isn't yet wired through
   * for Capacitor and should surface a friendly "not yet supported on iOS"
   * error rather than a silent hang.
   */
  _legacyWebRoot(): FileSystemDirectoryHandle;
}

export class NotSupportedOnNativeError extends Error {
  constructor(feature: string) {
    super(
      `${feature} isn't yet wired through to the iOS / Android Capacitor build. Use the desktop web build (Chrome / Edge) for now, or open an issue.`,
    );
    this.name = "NotSupportedOnNativeError";
  }
}
