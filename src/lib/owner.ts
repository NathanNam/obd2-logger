const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_LEN = 32;

export function normalizeOwner(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);
}

export function isValidOwner(value: string): boolean {
  if (!value) return false;
  if (value.length > MAX_LEN) return false;
  return SLUG_RE.test(value);
}

export function ownerError(value: string): string | null {
  if (!value) return "Required.";
  if (value.length > MAX_LEN) return `Max ${MAX_LEN} characters.`;
  if (!SLUG_RE.test(value)) {
    return "Lowercase letters, digits, and dashes only. Cannot start or end with a dash.";
  }
  return null;
}

export function suggestDefaultOwner(): string {
  return "me";
}
