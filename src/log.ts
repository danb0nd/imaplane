type Extra = Record<string, unknown>;

const SECRET_KEYS = new Set([
  "password",
  "pass",
  "token",
  "authorization",
  "icloud_app_password",
  "bridge_token",
  "imaplane_token",
  "app_password",
  "auth",
  "smtp_password",
]);

function redact(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function write(level: string, msg: string, extra?: Extra): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (extra) Object.assign(line, redact(extra) as Extra);
  // MCP stdio must keep stdout for JSON-RPC only.
  const mcp = Boolean(process.argv[1]?.includes("mcp"));
  const sink = level === "error" || mcp ? console.error : console.log;
  sink(JSON.stringify(line));
}

export const log = {
  info: (msg: string, extra?: Extra) => write("info", msg, extra),
  warn: (msg: string, extra?: Extra) => write("warn", msg, extra),
  error: (msg: string, extra?: Extra) => write("error", msg, extra),
};
