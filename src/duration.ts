/** Parse 30s / 15m / 1h / 2d or a raw millisecond number. */
export function parseDuration(raw: string | number | undefined, fallbackMs: number): number {
  if (raw === undefined || raw === "") return fallbackMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const text = String(raw).trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(text);
  if (!m) throw new Error(`invalid duration: ${raw}`);
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const mul =
    unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const ms = n * mul;
  if (!Number.isFinite(ms) || ms < 1) throw new Error(`invalid duration: ${raw}`);
  return ms;
}
