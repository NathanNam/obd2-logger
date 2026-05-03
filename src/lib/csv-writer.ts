export class CsvWriter {
  private stream: FileSystemWritableFileStream;
  private columnIds: string[];
  private metadata: Record<string, string>;
  private rowCount = 0;
  private buffer = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  static async create(
    dir: FileSystemDirectoryHandle,
    filename: string,
    columnIds: string[],
    metadata: Record<string, string> = {},
  ): Promise<CsvWriter> {
    const file = await dir.getFileHandle(filename, { create: true });
    const stream = await file.createWritable();
    const writer = new CsvWriter(stream, columnIds, metadata);
    await writer.writeHeader();
    return writer;
  }

  private constructor(
    stream: FileSystemWritableFileStream,
    columnIds: string[],
    metadata: Record<string, string>,
  ) {
    this.stream = stream;
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
    await this.stream.write(header + "\n");
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
    await this.stream.write(out);
  }

  rows(): number {
    return this.rowCount;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    await this.stream.close();
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
