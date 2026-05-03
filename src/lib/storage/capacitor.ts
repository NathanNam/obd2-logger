import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import {
  type AppendableWriter,
  type Entry,
  NotSupportedOnNativeError,
  type Storage,
} from "./types";

const ROOT_DIRECTORY: Directory = Directory.Documents;

/**
 * Storage backed by Capacitor Filesystem. On iOS this maps to the app's
 * sandboxed Documents directory (visible via the Files app); on Android, to
 * the Documents folder. There is no folder-picker step — files always live
 * under the app's root.
 */
export class CapacitorStorage implements Storage {
  readonly label = "On-device storage";

  isReady(): boolean {
    return true;
  }

  async ensureDir(path: string): Promise<void> {
    if (!path) return;
    try {
      await Filesystem.mkdir({
        path,
        directory: ROOT_DIRECTORY,
        recursive: true,
      });
    } catch (e) {
      // mkdir throws if the directory already exists. Capacitor doesn't
      // expose a typed error for this, so we swallow and verify via stat.
      const exists = await this.exists(path);
      if (!exists) throw e;
    }
  }

  async exists(path: string): Promise<boolean> {
    if (!path) return true;
    try {
      await Filesystem.stat({ path, directory: ROOT_DIRECTORY });
      return true;
    } catch {
      return false;
    }
  }

  async readText(path: string): Promise<string> {
    const result = await Filesystem.readFile({
      path,
      directory: ROOT_DIRECTORY,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === "string" ? result.data : await blobToText(result.data);
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.ensureDir(parentOf(path));
    await Filesystem.writeFile({
      path,
      data: content,
      directory: ROOT_DIRECTORY,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async appendText(path: string, content: string): Promise<void> {
    if (!(await this.exists(path))) {
      await this.writeText(path, content);
      return;
    }
    await Filesystem.appendFile({
      path,
      data: content,
      directory: ROOT_DIRECTORY,
      encoding: Encoding.UTF8,
    });
  }

  async removeFile(path: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path, directory: ROOT_DIRECTORY });
    } catch {
      // not present, ignore
    }
  }

  async listDir(path: string): Promise<Entry[]> {
    const result = await Filesystem.readdir({ path, directory: ROOT_DIRECTORY });
    return result.files.map((f) => ({
      name: f.name,
      kind: f.type === "directory" ? "directory" : "file",
    }));
  }

  async openWriter(
    path: string,
    opts?: { append?: boolean },
  ): Promise<AppendableWriter> {
    const append = opts?.append === true;
    if (append && (await this.exists(path))) {
      return new CapacitorWriter(path, "append");
    }
    // Truncate / create.
    await this.writeText(path, "");
    return new CapacitorWriter(path, "append");
  }

  _legacyWebRoot(): FileSystemDirectoryHandle {
    throw new NotSupportedOnNativeError("This feature");
  }
}

/**
 * A simple buffered writer over Filesystem.appendFile. Flushes on every call
 * to write() are too slow for the CSV writer (one bridge round-trip per row),
 * so we buffer and let the consumer call flush() on its own cadence — the
 * existing CSV writer already has a 1s flush timer.
 */
class CapacitorWriter implements AppendableWriter {
  private path: string;
  private mode: "append";
  private buffer = "";
  private closed = false;

  constructor(path: string, mode: "append") {
    this.path = path;
    this.mode = mode;
  }

  async write(text: string): Promise<void> {
    if (this.closed) return;
    this.buffer += text;
  }

  async flush(): Promise<void> {
    if (!this.buffer) return;
    const out = this.buffer;
    this.buffer = "";
    await Filesystem.appendFile({
      path: this.path,
      data: out,
      directory: ROOT_DIRECTORY,
      encoding: Encoding.UTF8,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    // mode is currently always "append" but kept on the writer for forward
    // compatibility if/when truncation modes are added.
    void this.mode;
  }
}

async function blobToText(blob: Blob): Promise<string> {
  return blob.text();
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}
