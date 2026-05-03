import type { Elm327 } from "./elm327";

const VIN_LEN = 17;

// Mode 09 PID 02 returns the VIN as a multi-frame ISO-TP message.
// With ATCAF1 (auto flow control) on, ELM327 typically yields lines like:
//   014        — total response byte count (hex)
//   0:4902014A — first frame (NCM = 0, then 49 02 01 [first VIN char as hex])
//   1:54JHGCFZ — second frame
//   2:34L20123 — third frame
//   3:45......
// Some adapters present it as a single bracket-delimited block, others
// space-separated. This parser is permissive — strips bracketed indices,
// concatenates the remaining hex, locates the 4902 service+pid header,
// reads ASCII bytes after it, and returns the trimmed 17-character VIN.

export async function readVin(elm: Elm327): Promise<string | null> {
  const resp = await elm.send("0902", { timeoutMs: 5000 });
  if (resp.errors.length) return null;
  return parseVinResponse(resp.lines);
}

export function parseVinResponse(lines: string[]): string | null {
  const compact = lines
    .map((l) => l.replace(/\s+/g, ""))
    .filter((l) => l.length > 0)
    .map(stripFrameIndex)
    .join("");
  const upper = compact.toUpperCase();
  const headerIdx = findHeader(upper);
  if (headerIdx < 0) return null;
  const dataHex = upper.slice(headerIdx + 6);
  const ascii = hexToAscii(dataHex).trim();
  if (ascii.length < VIN_LEN) return null;
  const vin = pickVinFromAscii(ascii);
  return vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

function stripFrameIndex(line: string): string {
  const colonIdx = line.indexOf(":");
  if (colonIdx > 0 && colonIdx <= 2) return line.slice(colonIdx + 1);
  return line;
}

function findHeader(s: string): number {
  // Look for "4902" service-positive-response + PID, possibly preceded by a
  // single-byte response length and the optional 01 frame counter (NCM).
  // Prefer the first occurrence after position 0.
  const idx = s.indexOf("4902");
  return idx;
}

function hexToAscii(hex: string): string {
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) continue;
    if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += " ";
  }
  return out;
}

function pickVinFromAscii(ascii: string): string | null {
  // After the 4902 prefix the first byte is the message count (0x01).
  // The remaining bytes are the VIN ASCII, sometimes prefixed with a
  // few non-printable padding bytes that became spaces above. Find the
  // first run of 17 valid VIN characters.
  const match = ascii.match(/[A-HJ-NPR-Z0-9]{17}/);
  return match ? match[0] : null;
}
