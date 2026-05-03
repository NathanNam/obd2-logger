import type { Elm327 } from "./elm327";

const BANK_QUERIES: { cmd: string; baseHex: number }[] = [
  { cmd: "0100", baseHex: 0x01 },
  { cmd: "0120", baseHex: 0x21 },
  { cmd: "0140", baseHex: 0x41 },
  { cmd: "0160", baseHex: 0x61 },
  { cmd: "0180", baseHex: 0x81 },
  { cmd: "01A0", baseHex: 0xa1 },
];

export async function discoverStandardPids(elm: Elm327): Promise<string[]> {
  const supported: string[] = [];
  let probeNext = true;
  for (const bank of BANK_QUERIES) {
    if (!probeNext) break;
    const resp = await elm.send(bank.cmd);
    if (resp.errors.length) {
      probeNext = false;
      continue;
    }
    const hex = extractDataHex(resp.lines, "41" + bank.cmd.slice(2));
    if (!hex || hex.length < 8) {
      probeNext = false;
      continue;
    }
    const bytes = hexToBytes(hex.slice(0, 8));
    const pidsInBank: string[] = [];
    for (let byte = 0; byte < 4; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        if (bytes[byte] & (1 << (7 - bit))) {
          const offset = byte * 8 + bit;
          const pidNum = bank.baseHex + offset;
          pidsInBank.push(pidNum.toString(16).padStart(2, "0").toUpperCase());
        }
      }
    }
    supported.push(...pidsInBank);
    const lastSupported = bytes[3] & 0x01;
    probeNext = lastSupported === 1;
  }
  return supported;
}

export function extractDataHex(lines: string[], expectedPrefix: string): string | null {
  const target = expectedPrefix.toUpperCase().replace(/\s+/g, "");
  for (const line of lines) {
    const compact = line.toUpperCase().replace(/\s+/g, "");
    if (compact.includes(target)) {
      const idx = compact.indexOf(target);
      return compact.slice(idx + target.length);
    }
  }
  return null;
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}
