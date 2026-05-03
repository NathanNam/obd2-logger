// Sandboxed formula evaluator for OBD2 PID byte-position formulas.
//
// Supported tokens:
//   - A, B, C, D, E, F, G, H — response bytes (0-indexed mapping: A=byte 0, etc.)
//   - integers and decimals: 256, 1.5, 0.5
//   - hex literals: 0xff, 0x100
//   - operators: + - * / % parentheses
//   - functions (whitelisted): min, max, abs, signed (signed turns A into a signed int8 etc.)
//
// No identifiers other than the byte names and whitelisted functions are allowed.
// No statements, no member access, no string literals.

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  signed: (n: number) => (n > 0x7f ? n - 0x100 : n),
};

const BYTE_VARS = ["A", "B", "C", "D", "E", "F", "G", "H"];

type Tok =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "fn"; name: string }
  | { kind: "op"; op: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

export function evaluateFormula(formula: string, bytes: number[]): number {
  const tokens = tokenize(formula);
  const parser = new Parser(tokens, bytes);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

function tokenize(input: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    if ("+-*/%".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      if (ch === "0" && (input[i + 1] === "x" || input[i + 1] === "X")) {
        i += 2;
        while (i < input.length && /[0-9a-fA-F]/.test(input[i])) i++;
        tokens.push({ kind: "num", value: parseInt(input.slice(start, i), 16) });
        continue;
      }
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      tokens.push({ kind: "num", value: Number(input.slice(start, i)) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) i++;
      const name = input.slice(start, i);
      if (BYTE_VARS.includes(name)) {
        tokens.push({ kind: "var", name });
      } else if (FUNCTIONS[name]) {
        tokens.push({ kind: "fn", name });
      } else {
        throw new Error(`Unknown identifier '${name}' in formula '${input}'.`);
      }
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i} in formula '${input}'.`);
  }
  return tokens;
}

class Parser {
  private tokens: Tok[];
  private bytes: number[];
  private pos = 0;

  constructor(tokens: Tok[], bytes: number[]) {
    this.tokens = tokens;
    this.bytes = bytes;
  }

  parseExpression(): number {
    return this.parseAddSub();
  }

  expectEnd(): void {
    if (this.pos !== this.tokens.length) {
      throw new Error("Unexpected trailing tokens in formula.");
    }
  }

  private peek(): Tok | undefined {
    return this.tokens[this.pos];
  }

  private next(): Tok {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("Unexpected end of formula.");
    return t;
  }

  private parseAddSub(): number {
    let left = this.parseMulDivMod();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.op !== "+" && t.op !== "-")) break;
      this.pos++;
      const right = this.parseMulDivMod();
      left = t.op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseMulDivMod(): number {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.op !== "*" && t.op !== "/" && t.op !== "%")) break;
      this.pos++;
      const right = this.parseUnary();
      if (t.op === "*") left *= right;
      else if (t.op === "/") left /= right;
      else left %= right;
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t && t.kind === "op" && (t.op === "+" || t.op === "-")) {
      this.pos++;
      const v = this.parseUnary();
      return t.op === "-" ? -v : v;
    }
    return this.parseAtom();
  }

  private parseAtom(): number {
    const t = this.next();
    if (t.kind === "num") return t.value;
    if (t.kind === "var") return this.byteValue(t.name);
    if (t.kind === "lparen") {
      const v = this.parseExpression();
      const close = this.next();
      if (close.kind !== "rparen") throw new Error("Expected ')'.");
      return v;
    }
    if (t.kind === "fn") {
      const open = this.next();
      if (open.kind !== "lparen") throw new Error(`Expected '(' after ${t.name}.`);
      const args: number[] = [];
      const peek = this.peek();
      if (!peek || peek.kind !== "rparen") {
        args.push(this.parseExpression());
        while (true) {
          const sep = this.peek();
          if (!sep || sep.kind !== "comma") break;
          this.pos++;
          args.push(this.parseExpression());
        }
      }
      const close = this.next();
      if (close.kind !== "rparen") throw new Error("Expected ')' in function call.");
      return FUNCTIONS[t.name](...args);
    }
    throw new Error("Unexpected token in formula.");
  }

  private byteValue(name: string): number {
    const idx = BYTE_VARS.indexOf(name);
    if (idx < 0) throw new Error(`Unknown byte variable ${name}.`);
    if (idx >= this.bytes.length) {
      throw new Error(
        `Formula references byte ${name} (index ${idx}) but only ${this.bytes.length} bytes were returned.`,
      );
    }
    return this.bytes[idx];
  }
}
