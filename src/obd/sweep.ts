import { ensureOwnerDir } from "../lib/fs";
import { ensureSessionsDir } from "../lib/vehicles";
import { connection } from "./connection";
import { hexToBytes } from "./discover";
import type { Elm327, ElmError } from "./elm327";

export type SweepResponse = {
  ecu: string;
  request_header: string;
  mode: string;
  pid: string;
  status: "ok" | "no_data" | "error" | "no_response" | "rejected";
  response_hex?: string;
  byte_count?: number;
  errors?: ElmError[];
  raw_lines?: string[];
  /** ISO 14229 negative response code, e.g. 0x11. Only set when status === "rejected". */
  nrc_code?: string;
  /** Human-readable name for nrc_code, e.g. "serviceNotSupported". */
  nrc_name?: string;
};

// ISO 14229-1 §7.5.1 Table 9: Negative Response Codes.
// Subset covering codes a sweep is likely to see.
export const UDS_NRC_NAMES: Record<string, string> = {
  "10": "generalReject",
  "11": "serviceNotSupported",
  "12": "subFunctionNotSupported",
  "13": "incorrectMessageLengthOrInvalidFormat",
  "14": "responseTooLong",
  "21": "busyRepeatRequest",
  "22": "conditionsNotCorrect",
  "24": "requestSequenceError",
  "25": "noResponseFromSubnetComponent",
  "26": "failurePreventsExecutionOfRequestedAction",
  "31": "requestOutOfRange",
  "33": "securityAccessDenied",
  "35": "invalidKey",
  "36": "exceedNumberOfAttempts",
  "37": "requiredTimeDelayNotExpired",
  "70": "uploadDownloadNotAccepted",
  "71": "transferDataSuspended",
  "72": "generalProgrammingFailure",
  "73": "wrongBlockSequenceCounter",
  "78": "requestCorrectlyReceivedResponsePending",
  "7E": "subFunctionNotSupportedInActiveSession",
  "7F": "serviceNotSupportedInActiveSession",
};

/** Detect a UDS negative response of the form 7F<service><nrc>. */
function parseNrc(line: string, mode: string): { nrc_code: string; nrc_name: string } | null {
  const compact = line.toUpperCase().replace(/\s+/g, "");
  // Expected layout: 7F<service><nrc>. Service must match the mode we sent.
  const match = compact.match(/7F([0-9A-F]{2})([0-9A-F]{2})/);
  if (!match) return null;
  const service = match[1];
  if (service !== mode.toUpperCase()) return null;
  const nrc = match[2];
  return { nrc_code: nrc, nrc_name: UDS_NRC_NAMES[nrc] ?? `unknown(0x${nrc})` };
}

export type SweepReport = {
  vehicle_slug: string;
  profile_id: string;
  vin: string | null;
  started_utc: string;
  ended_utc: string;
  pid_count: number;
  responsive_count: number;
  ecus: { name: string; request_header: string; response_header: string }[];
  modes: string[];
  responses: SweepResponse[];
};

export type SweepProgress = {
  current: number;
  total: number;
  ecu: string;
  pid: string;
  responsive: number;
};

export type SweepEcu = {
  name: string;
  request_header: string;
  response_header: string;
};

const DEFAULT_ECUS: SweepEcu[] = [
  { name: "engine", request_header: "7E0", response_header: "7E8" },
  { name: "transmission", request_header: "7E1", response_header: "7E9" },
  { name: "hybrid_controller", request_header: "7E2", response_header: "7EA" },
  { name: "battery_controller", request_header: "7E3", response_header: "7EB" },
];

export type ModeRange = {
  mode: string;
  pidStart: number;
  pidEnd: number;
};

export type SweepOpts = {
  ecus?: SweepEcu[];
  /** Per-mode PID range. Mode 21 uses 1-byte PIDs (0x00-0xFF);
   *  Mode 22 uses 2-byte PIDs (0x0000-0xFFFF). */
  modeRanges?: ModeRange[];
  perPidTimeoutMs?: number;
  onProgress?: (p: SweepProgress) => void;
  abortSignal?: AbortSignal;
};

const DEFAULT_MODE_RANGES: ModeRange[] = [
  { mode: "21", pidStart: 0x00, pidEnd: 0xff },
  // Toyota/Lexus DataIdentifiers cluster around 0x0100-0x01FF for live data.
  // Sweeping the full 16-bit space is impractical (~2 hours).
  { mode: "22", pidStart: 0x0100, pidEnd: 0x01ff },
];

export async function runSweep(elm: Elm327, opts: SweepOpts = {}): Promise<SweepResponse[]> {
  const ecus = opts.ecus ?? DEFAULT_ECUS;
  const modeRanges = opts.modeRanges ?? DEFAULT_MODE_RANGES;
  const timeoutMs = opts.perPidTimeoutMs ?? 900;

  const total =
    ecus.length *
    modeRanges.reduce((sum, r) => sum + (r.pidEnd - r.pidStart + 1), 0);
  const responses: SweepResponse[] = [];
  let count = 0;
  let responsive = 0;

  const wantsMode22 = modeRanges.some((r) => r.mode === "22");

  for (const ecu of ecus) {
    if (opts.abortSignal?.aborted) break;
    await elm.send(`ATSH${ecu.request_header}`, { timeoutMs: 800 }).catch(() => null);

    // Hyundai-Kia and other modern manufacturers gate most Mode 22 live-data
    // DIDs behind the extended diagnostic session (UDS service 10 03).
    // F1xx identification DIDs are accessible in the default session but the
    // live SOC / HV / motor / cell-temp data is not. Enter extended session
    // before sweeping Mode 22; ignore the response (some ECUs accept silently,
    // some return NRC — in either case we just continue and let the sweep
    // surface whatever DIDs are now reachable).
    if (wantsMode22) {
      await elm.send("1003", { timeoutMs: 1200 }).catch(() => null);
    }

    for (const range of modeRanges) {
      const mode = range.mode.toUpperCase();
      const pidWidth = mode === "21" ? 2 : 4;
      for (let pid = range.pidStart; pid <= range.pidEnd; pid++) {
        if (opts.abortSignal?.aborted) break;
        const pidHex = pid.toString(16).padStart(pidWidth, "0").toUpperCase();
        const cmd = (mode + pidHex).toUpperCase();

        let resp;
        try {
          resp = await elm.send(cmd, { timeoutMs });
        } catch (e) {
          responses.push({
            ecu: ecu.name,
            request_header: ecu.request_header,
            mode,
            pid: pidHex,
            status: "error",
            errors: ["TIMEOUT"],
            raw_lines: [e instanceof Error ? e.message : String(e)],
          });
          count++;
          opts.onProgress?.({ current: count, total, ecu: ecu.name, pid: pidHex, responsive });
          continue;
        }

        const positivePrefix = positiveResponsePrefix(mode, pidHex);
        const data = resp.lines
          .map((l) => l.toUpperCase().replace(/\s+/g, ""))
          .filter((l) => l.length > 0);

        if (resp.errors.includes("NO_DATA")) {
          responses.push({
            ecu: ecu.name,
            request_header: ecu.request_header,
            mode,
            pid: pidHex,
            status: "no_data",
            errors: resp.errors,
          });
        } else if (resp.errors.length > 0) {
          responses.push({
            ecu: ecu.name,
            request_header: ecu.request_header,
            mode,
            pid: pidHex,
            status: "error",
            errors: resp.errors,
            raw_lines: data,
          });
        } else {
          const matchLine = data.find((l) => l.includes(positivePrefix));
          if (matchLine) {
            const payload = assembleMultiFramePayload(data, positivePrefix);
            const bytes = hexToBytes(payload);
            responses.push({
              ecu: ecu.name,
              request_header: ecu.request_header,
              mode,
              pid: pidHex,
              status: "ok",
              response_hex: payload,
              byte_count: bytes.length,
              raw_lines: data,
            });
            responsive++;
          } else if (data.length === 0) {
            responses.push({
              ecu: ecu.name,
              request_header: ecu.request_header,
              mode,
              pid: pidHex,
              status: "no_response",
            });
          } else {
            // Try to recognize a UDS negative response (7F<svc><nrc>).
            // The whole table will share one rejection if the ECU just
            // doesn't support the mode at all — but each is recorded so the
            // UI can display the rejection name instead of generic "error".
            const nrc = data.map((l) => parseNrc(l, mode)).find((n) => n !== null);
            if (nrc) {
              responses.push({
                ecu: ecu.name,
                request_header: ecu.request_header,
                mode,
                pid: pidHex,
                status: "rejected",
                nrc_code: nrc.nrc_code,
                nrc_name: nrc.nrc_name,
                raw_lines: data,
              });
            } else {
              responses.push({
                ecu: ecu.name,
                request_header: ecu.request_header,
                mode,
                pid: pidHex,
                status: "error",
                errors: [],
                raw_lines: data,
              });
            }
          }
        }

        count++;
        opts.onProgress?.({
          current: count,
          total,
          ecu: ecu.name,
          pid: pidHex,
          responsive,
        });
      }
    }
  }

  await elm.send("ATSH7E0").catch(() => null);
  return responses;
}

function positiveResponsePrefix(mode: string, pid: string): string {
  const modeNum = parseInt(mode, 16);
  return ((modeNum + 0x40).toString(16).padStart(2, "0") + pid).toUpperCase();
}

/**
 * Reassemble an ELM327 multi-frame ISO-TP response into a single hex payload.
 * Single-frame responses arrive as one line containing the positive prefix.
 * Multi-frame responses arrive as a length header line ("03E") followed by
 * frames of the form "<n>:<hex>" where n is the 0-indexed frame number; the
 * first frame contains the positive prefix and the others are pure data.
 * Strips the prefix and any trailing AA padding bytes.
 */
function assembleMultiFramePayload(lines: string[], positivePrefix: string): string {
  const frames: { idx: number; hex: string }[] = [];
  let firstLine = "";
  for (const line of lines) {
    const m = line.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m) {
      frames.push({ idx: parseInt(m[1], 16), hex: m[2] });
    } else if (line.includes(positivePrefix) && !firstLine) {
      firstLine = line;
    }
  }
  if (frames.length === 0) {
    // Single-frame: just slice off the prefix from the matched line.
    const idx = firstLine.indexOf(positivePrefix);
    return idx >= 0 ? firstLine.slice(idx + positivePrefix.length) : "";
  }
  frames.sort((a, b) => a.idx - b.idx);
  const concatenated = frames.map((f) => f.hex).join("");
  const prefixIdx = concatenated.indexOf(positivePrefix);
  if (prefixIdx < 0) return concatenated;
  let payload = concatenated.slice(prefixIdx + positivePrefix.length);
  // Strip trailing AA padding (CAN frame padding when the data doesn't fill
  // the last 8-byte frame). Conservative: only strip a run of >=2 trailing AAs.
  payload = payload.replace(/(AA){2,}$/i, "");
  return payload;
}

export type SweepRunResult = {
  report: SweepReport;
  filename: string;
  saveError: string | null;
};

export async function runSweepForActiveVehicle(opts: {
  rootDir: FileSystemDirectoryHandle;
  owner: string;
  vehicleSlug: string;
  profileId: string;
  vin: string | null;
  ecus: SweepEcu[];
  modeRanges: ModeRange[];
  onProgress?: (p: SweepProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<SweepRunResult> {
  const elm = connection.getElm();
  if (!elm) throw new Error("Connection is not ready.");

  const startedUtc = new Date().toISOString();
  const responses = await runSweep(elm, {
    ecus: opts.ecus,
    modeRanges: opts.modeRanges,
    onProgress: opts.onProgress,
    abortSignal: opts.abortSignal,
  });
  const endedUtc = new Date().toISOString();
  const responsive = responses.filter((r) => r.status === "ok").length;

  const report: SweepReport = {
    vehicle_slug: opts.vehicleSlug,
    profile_id: opts.profileId,
    vin: opts.vin,
    started_utc: startedUtc,
    ended_utc: endedUtc,
    pid_count: responses.length,
    responsive_count: responsive,
    ecus: opts.ecus,
    modes: opts.modeRanges.map((r) => r.mode),
    responses,
  };

  const filename = `sweep__${startedUtc.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z")}.json`;
  let saveError: string | null = null;
  try {
    const ownerDir = await ensureOwnerDir(opts.rootDir, opts.owner);
    const sessionsDir = await ensureSessionsDir(ownerDir, opts.vehicleSlug);
    const handle = await sessionsDir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(report, null, 2));
    await writable.close();
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
  }

  return { report, filename, saveError };
}
