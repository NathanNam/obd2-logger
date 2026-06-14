import type { PidDef } from "../profiles/types";
import { hexToBytes } from "./discover";
import { evaluateFormula } from "./formula";

export function buildCommand(def: PidDef): string {
  return (def.mode + def.pid).toUpperCase();
}

export function expectedPrefix(def: PidDef): string {
  // ELM327 positive response = mode + 0x40 then pid. e.g., 01 0C → 41 0C.
  const modeNum = parseInt(def.mode, 16);
  const respMode = (modeNum + 0x40).toString(16).padStart(2, "0").toUpperCase();
  return respMode + def.pid.toUpperCase();
}

export type DecodeOutcome =
  | { ok: true; value: number; rawBytes: number[] }
  | { ok: false; reason: string; rawBytes: number[] };

export function decodePidResponse(def: PidDef, lines: string[]): DecodeOutcome {
  const prefix = expectedPrefix(def);
  const compactLines = lines.map((l) => l.toUpperCase().replace(/\s+/g, ""));

  // Multi-frame ISO-TP: lines arrive as `<digit>:<6-7 bytes hex>`. The first
  // frame (0:) contains the positive response prefix; continuation frames
  // (1:, 2:, ...) are pure data. Without this, Mode 22 DIDs that return long
  // payloads (e.g. Hyundai-Kia BMS DID 0101 = 59 bytes) appeared as 3 bytes
  // and every byte past the first frame was silently dropped.
  const frames: { idx: number; hex: string }[] = [];
  for (const line of compactLines) {
    const m = line.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m) frames.push({ idx: parseInt(m[1], 16), hex: m[2] });
  }
  if (frames.length > 0) {
    frames.sort((a, b) => a.idx - b.idx);
    const joined = frames.map((f) => f.hex).join("");
    const prefixIdx = joined.indexOf(prefix);
    if (prefixIdx >= 0) {
      let after = joined.slice(prefixIdx + prefix.length);
      // CAN frame padding: last frame is padded with AA bytes when the
      // payload doesn't fill the 8-byte slot. Strip a run of >=2 trailing AAs.
      after = after.replace(/(AA){2,}$/i, "");
      const bytes = hexToBytes(after);
      if (bytes.length === 0) {
        return { ok: false, reason: "no-payload", rawBytes: bytes };
      }
      if (bytes.every((b) => b === 0xff)) {
        return { ok: false, reason: "all-FF-sentinel", rawBytes: bytes };
      }
      try {
        const value = evaluateFormula(def.formula, bytes);
        return { ok: true, value, rawBytes: bytes };
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
          rawBytes: bytes,
        };
      }
    }
    // Fall through to single-line search if no frame contained the prefix.
  }

  for (const compact of compactLines) {
    const idx = compact.indexOf(prefix);
    if (idx < 0) continue;
    const after = compact.slice(idx + prefix.length);
    const bytes = hexToBytes(after);
    if (bytes.length === 0) {
      return { ok: false, reason: "no-payload", rawBytes: bytes };
    }
    // SAE J1979 convention: ECUs report "I support this PID but have no
    // data right now" by returning all-0xFF in the payload. Treat it as
    // missing, not as a real value of 65535 km / 255 / etc.
    if (bytes.every((b) => b === 0xff)) {
      return { ok: false, reason: "all-FF-sentinel", rawBytes: bytes };
    }
    try {
      const value = evaluateFormula(def.formula, bytes);
      return { ok: true, value, rawBytes: bytes };
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
        rawBytes: bytes,
      };
    }
  }
  return { ok: false, reason: "no-matching-line", rawBytes: [] };
}
