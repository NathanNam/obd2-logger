export type SessionRecord = {
  session_id: string;
  start_utc: string;
  end_utc: string;
  duration_ms: number;
  sample_rate_hz: number;
  row_count: number;
  profile_id: string;
  profile_version: string;
  registry_hash: string;
  pid_count: number;
  file: string;
  ended_reason: "user_stop" | "disconnect_timeout" | "error" | "tab_closed";
  mean_pid_completion_pct: number;
  raw_mode?: boolean;
};

const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

export function generateSessionId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += BASE32[b % BASE32.length];
  return out + BASE32[Math.floor(Math.random() * BASE32.length)] + BASE32[Math.floor(Math.random() * BASE32.length)] + BASE32[Math.floor(Math.random() * BASE32.length)];
}

export function sessionFilename(startIso: string, sessionId: string): string {
  const safe = startIso.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  return `${safe}__${sessionId}.csv`;
}

export async function appendSessionRecord(
  vehicleDir: FileSystemDirectoryHandle,
  record: SessionRecord,
): Promise<void> {
  const file = await vehicleDir.getFileHandle("sessions.jsonl", { create: true });
  const existing = await readAllText(file);
  const stream = await file.createWritable();
  const newline = existing && !existing.endsWith("\n") ? "\n" : "";
  await stream.write(existing + newline + JSON.stringify(record) + "\n");
  await stream.close();
}

export async function readSessionsJsonl(
  vehicleDir: FileSystemDirectoryHandle,
): Promise<SessionRecord[]> {
  let file: FileSystemFileHandle;
  try {
    file = await vehicleDir.getFileHandle("sessions.jsonl", { create: false });
  } catch {
    return [];
  }
  const text = await readAllText(file);
  const out: SessionRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as SessionRecord);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

async function readAllText(file: FileSystemFileHandle): Promise<string> {
  try {
    const f = await file.getFile();
    if (f.size === 0) return "";
    return await f.text();
  } catch {
    return "";
  }
}
