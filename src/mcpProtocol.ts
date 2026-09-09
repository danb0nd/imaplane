import { HttpError, type MailBackend } from "./types.js";
import { buildMailTools } from "./mcpTools.js";
import { SERVICE, TITLE, VERSION } from "./version.js";

const SUPPORTED = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_PROTOCOL = "2025-03-26";
const MAX_TEXT = 18_000;

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export async function handleMcpMessage(raw: string, backend: MailBackend): Promise<JsonRpcResponse | null> {
  let msg: JsonRpc;
  try {
    msg = JSON.parse(raw) as JsonRpc;
  } catch {
    return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  }
  if (msg.method && msg.id === undefined) {
    return null;
  }
  const id = msg.id ?? null;
  try {
    const result = await dispatch(msg.method ?? "", msg.params, backend);
    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    if (err instanceof RpcError) {
      return { jsonrpc: "2.0", id, error: { code: err.code, message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    const isTool = msg.method === "tools/call";
    if (isTool) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: message }],
          isError: true,
        },
      };
    }
    return { jsonrpc: "2.0", id, error: { code: -32603, message } };
  }
}

async function dispatch(method: string, params: unknown, backend: MailBackend): Promise<unknown> {
  switch (method) {
    case "initialize":
      return initialize(params, backend);
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: (await toolsFor(backend)).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    case "tools/call":
      return callTool(params, backend);
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new RpcError(-32601, `method not found: ${method}`);
  }
}

async function toolsFor(backend: MailBackend) {
  const health = await backend.health();
  return buildMailTools(Boolean(health.send_enabled));
}

async function initialize(params: unknown, backend: MailBackend) {
  const requested =
    params && typeof params === "object" && params !== null && "protocolVersion" in params
      ? String((params as { protocolVersion: unknown }).protocolVersion)
      : "";
  const health = await backend.health();
  const send = Boolean(health.send_enabled);
  return {
    protocolVersion: SUPPORTED.has(requested) ? requested : DEFAULT_PROTOCOL,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: SERVICE,
      version: VERSION,
      title: TITLE,
    },
    instructions: send
      ? `${TITLE}: local IMAP organiser (iCloud or generic IMAP). Send is opt-in and enabled on this instance — only send when the user clearly asks. If they ask about folder setup, interview them, propose a small tree, confirm, then create. Never clobber personal folders like Important unless they explicitly say so. Typical triage: mail_list unseen INBOX → mail_read if needed → mail_move → mail_flags add \\Seen.`
      : `${TITLE}: local IMAP organiser (iCloud or generic IMAP). Never send mail — this server has no send path. If the user asks about folder setup, interview them, propose a small tree, confirm, then create. Never clobber personal folders like Important unless they explicitly say so. Typical triage: mail_list unseen INBOX → mail_read if needed → mail_move → mail_flags add \\Seen. Report a digest; do not email anyone.`,
  };
}

async function callTool(params: unknown, backend: MailBackend) {
  const name =
    params && typeof params === "object" && params !== null && "name" in params
      ? String((params as { name: unknown }).name)
      : "";
  const argsRaw =
    params && typeof params === "object" && params !== null && "arguments" in params
      ? (params as { arguments: unknown }).arguments
      : {};
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};
  const tool = (await toolsFor(backend)).find((item) => item.name === name);
  if (!tool) throw new HttpError(404, `unknown tool: ${name}`);
  const data = await tool.run(backend, args);
  return {
    content: [{ type: "text", text: asText(data) }],
    isError: false,
  };
}

function asText(data: unknown): string {
  const text = JSON.stringify(data, null, 2);
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}\n…truncated`;
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
