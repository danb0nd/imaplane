/** Minimal 5-field cron (min hour dom month dow). Supports star, N, star/N, A-B, and lists. */
export function cronMatches(expr: string, date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron must have 5 fields: ${expr}`);
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();
  return (
    fieldMatches(parts[0]!, minute, 0, 59) &&
    fieldMatches(parts[1]!, hour, 0, 23) &&
    fieldMatches(parts[2]!, dom, 1, 31) &&
    fieldMatches(parts[3]!, month, 1, 12) &&
    fieldMatches(parts[4]!, dow, 0, 6)
  );
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(",").some((part) => matchPart(part, value, min, max));
}

function matchPart(part: string, value: number, min: number, max: number): boolean {
  if (part === "*") return true;
  const stepMatch = /^(?:\*|\d+(?:-\d+)?)\/(\d+)$/.exec(part);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    const base = part.split("/")[0]!;
    if (base === "*") return (value - min) % step === 0;
    const [a, b] = range(base, min, max);
    return value >= a && value <= b && (value - a) % step === 0;
  }
  if (part.includes("-")) {
    const [a, b] = range(part, min, max);
    return value >= a && value <= b;
  }
  const n = Number(part);
  if (!Number.isInteger(n)) throw new Error(`invalid cron field: ${part}`);
  return n === value;
}

function range(part: string, min: number, max: number): [number, number] {
  const [left, right] = part.split("-").map(Number);
  if (!Number.isInteger(left) || !Number.isInteger(right)) throw new Error(`invalid cron range: ${part}`);
  return [Math.max(min, left!), Math.min(max, right!)];
}
