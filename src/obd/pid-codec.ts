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
  for (const line of lines) {
    const compact = line.toUpperCase().replace(/\s+/g, "");
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
