import type { AppendableWriter, Storage } from "./storage";

/**
 * Streams CSV rows into a single file, with a 1s flush cadence to keep
 * cross-platform append costs sane. Wraps an AppendableWriter so it works
 * the same way for File System Access (web) and Capacitor Filesystem (iOS).
 */
export class CsvWriter {
  private writer: AppendableWriter;
  private columnIds: string[];
  private metadata: Record<string, string>;
  private rowCount = 0;
  private buffer = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  static async create(
    storage: Storage,
    path: string,
    columnIds: string[],
    metadata: Record<string, string> = {},
  ): Promise<CsvWriter> {
    const writer = await storage.openWriter(path, { append: false });
    const csv = new CsvWriter(writer, columnIds, metadata);
    await csv.writeHeader();
    return csv;
  }

  private constructor(
    writer: AppendableWriter,
    columnIds: string[],
    metadata: Record<string, string>,
  ) {
    this.writer = writer;
    this.columnIds = columnIds;
    this.metadata = metadata;
  }

  private async writeHeader(): Promise<void> {
    const metaKeys = Object.keys(this.metadata);
    const header = [
      "timestamp_utc",
      "session_elapsed_ms",
      ...metaKeys,
      ...this.columnIds,
    ].join(",");
    await this.writer.write(header + "\n");
    await this.writer.flush();
  }

  async writeRow(
    timestampIso: string,
    elapsedMs: number,
    values: Record<string, number | string | null | undefined>,
  ): Promise<void> {
    if (this.closed) return;

    let hasAnyValue = false;
    for (const id of this.columnIds) {
      if (hasValue(values[id])) {
        hasAnyValue = true;
        break;
      }
    }
    if (!hasAnyValue) return;

    const cells: string[] = [timestampIso, String(elapsedMs)];
    for (const k of Object.keys(this.metadata)) {
      cells.push(escapeCsv(this.metadata[k]));
    }
    for (const id of this.columnIds) {
      const v = values[id];
      if (!hasValue(v)) {
        cells.push("");
      } else if (typeof v === "string") {
        cells.push(v);
      } else {
        cells.push(formatNumber(v));
      }
    }
    this.buffer += cells.join(",") + "\n";
    this.rowCount++;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 1000);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.buffer) return;
    const out = this.buffer;
    this.buffer = "";
    await this.writer.write(out);
    await this.writer.flush();
  }

  rows(): number {
    return this.rowCount;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    await this.writer.close();
  }
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return Number(v.toFixed(3)).toString();
}

function hasValue(
  v: number | string | null | undefined,
): v is number | string {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  return !Number.isNaN(v);
}

function escapeCsv(s: string): string {
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
