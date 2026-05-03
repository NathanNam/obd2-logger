import type { AppendableWriter, Entry, Storage } from "./types";

/**
 * Storage backed by a user-picked FileSystemDirectoryHandle (File System
 * Access API). Used in Chrome / Edge desktop builds. All path lookups walk
 * down from `root` by splitting on "/".
 */
export class WebStorage implements Storage {
  readonly label = "Local folder";
  private root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  isReady(): boolean {
    return true;
  }

  async ensureDir(path: string): Promise<void> {
    await this.resolveDir(path, { create: true });
  }

  async exists(path: string): Promise<boolean> {
    if (!path) return true;
    const segments = splitPath(path);
    const last = segments.pop();
    if (!last) return true;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.resolveDir(segments.join("/"), { create: false });
    } catch {
      return false;
    }
    try {
      await dir.getFileHandle(last, { create: false });
      return true;
    } catch {
      try {
        await dir.getDirectoryHandle(last, { create: false });
        return true;
      } catch {
        return false;
      }
    }
  }

  async readText(path: string): Promise<string> {
    const file = await this.resolveFile(path, { create: false });
    const f = await file.getFile();
    return f.text();
  }

  async writeText(path: string, content: string): Promise<void> {
    const file = await this.resolveFile(path, { create: true });
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async appendText(path: string, content: string): Promise<void> {
    let existing = "";
    if (await this.exists(path)) {
      existing = await this.readText(path);
    }
    const newline = existing && !existing.endsWith("\n") ? "\n" : "";
    await this.writeText(path, existing + newline + content);
  }

  async removeFile(path: string): Promise<void> {
    const segments = splitPath(path);
    const last = segments.pop();
    if (!last) return;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.resolveDir(segments.join("/"), { create: false });
    } catch {
      return;
    }
    try {
      await dir.removeEntry(last);
    } catch {
      // not present
    }
  }

  async listDir(path: string): Promise<Entry[]> {
    const dir = await this.resolveDir(path, { create: false });
    const out: Entry[] = [];
    for await (const entry of dir.values()) {
      out.push({ name: entry.name, kind: entry.kind === "file" ? "file" : "directory" });
    }
    return out;
  }

  async openWriter(
    path: string,
    opts?: { append?: boolean },
  ): Promise<AppendableWriter> {
    const file = await this.resolveFile(path, { create: true });
    const append = opts?.append === true;
    const writable = await file.createWritable({ keepExistingData: append });
    if (append) {
      // Position at end of existing content.
      const existing = await file.getFile();
      await writable.seek(existing.size);
    }
    return new WebWriter(writable);
  }

  _legacyWebRoot(): FileSystemDirectoryHandle {
    return this.root;
  }

  private async resolveDir(
    path: string,
    opts: { create: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    const segments = splitPath(path);
    let dir = this.root;
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create: opts.create });
    }
    return dir;
  }

  private async resolveFile(
    path: string,
    opts: { create: boolean },
  ): Promise<FileSystemFileHandle> {
    const segments = splitPath(path);
    const filename = segments.pop();
    if (!filename) throw new Error(`Invalid file path: '${path}'`);
    const dir = await this.resolveDir(segments.join("/"), { create: opts.create });
    return dir.getFileHandle(filename, { create: opts.create });
  }
}

class WebWriter implements AppendableWriter {
  private stream: FileSystemWritableFileStream;
  private closed = false;

  constructor(stream: FileSystemWritableFileStream) {
    this.stream = stream;
  }

  async write(text: string): Promise<void> {
    if (this.closed) return;
    await this.stream.write(text);
  }

  async flush(): Promise<void> {
    // FileSystemWritableFileStream has no explicit flush; the OS handles
    // buffering. Closing is what makes the writes durable.
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stream.close();
  }
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}
