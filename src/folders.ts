import { HttpError } from "./types.js";

export function normalizeFolder(name: string, delimiter: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new HttpError(400, "folder is required");
  }
  if (/[\u0000\r\n]/.test(trimmed)) {
    throw new HttpError(400, "folder name contains invalid characters");
  }
  if (trimmed.toUpperCase() === "INBOX") return "INBOX";

  let path = trimmed;
  if (delimiter && delimiter !== "/" && path.includes("/") && !path.includes(delimiter)) {
    path = path
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(delimiter);
  }
  return path;
}

export function parseLimit(raw: unknown, fallback = 50, max = 200): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, "limit must be a positive integer");
  }
  return Math.min(n, max);
}

export function parseUid(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, "uid must be a positive integer");
  }
  return n;
}

export function parseBool(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  throw new HttpError(400, "expected a boolean query flag");
}

export function asStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}
