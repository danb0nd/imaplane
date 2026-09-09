import {
  HttpError,
  type AccountInfo,
  type FlagUpdate,
  type FolderApplyResult,
  type FolderProfile,
  type MailBackend,
  type MessageBody,
  type MessageHeader,
  type RuleApplyResult,
  type RuleDef,
  type SendOpts,
} from "./types.js";

export type BridgeClientConfig = {
  baseUrl: string;
  token: string;
};

export class HttpMailBackend implements MailBackend {
  constructor(private readonly cfg: BridgeClientConfig) {}

  start(): void {}
  async stop(): Promise<void> {}

  async health() {
    const data = (await this.request("GET", "/health")) as {
      send_enabled?: boolean;
      default_account?: string;
      imap?: {
        connected?: boolean;
        status?: "connected" | "connecting" | "disconnected";
        send_enabled?: boolean;
        default_account?: string;
        accounts?: {
          name: string;
          provider: "icloud" | "imap";
          connected: boolean;
          status: "connected" | "connecting" | "disconnected";
          send_enabled: boolean;
        }[];
      };
    };
    return {
      connected: Boolean(data.imap?.connected),
      status: data.imap?.status ?? (data.imap?.connected ? "connected" : "disconnected"),
      send_enabled: Boolean(data.send_enabled ?? data.imap?.send_enabled),
      default_account: data.default_account ?? data.imap?.default_account,
      accounts: data.imap?.accounts,
    };
  }

  async listAccounts() {
    const data = (await this.request("GET", "/accounts")) as { accounts: AccountInfo[] };
    return data.accounts;
  }

  async listFolders(account?: string) {
    const data = (await this.request("GET", `/folders${q({ account })}`)) as {
      folders: import("./types.js").FolderInfo[];
    };
    return data.folders;
  }

  async createFolder(name: string, account?: string) {
    return (await this.request("POST", `/folders${q({ account })}`, { name, account })) as {
      path: string;
      created: boolean;
    };
  }

  async listMessages(opts: { folder: string; limit: number; unseen?: boolean; account?: string }) {
    const qs = q({
      folder: opts.folder,
      limit: String(opts.limit),
      unseen: opts.unseen === undefined ? undefined : String(opts.unseen),
      account: opts.account,
    });
    const data = (await this.request("GET", `/messages${qs}`)) as { messages: MessageHeader[] };
    return data.messages;
  }

  async getMessage(uid: number, folder: string, account?: string): Promise<MessageBody | null> {
    try {
      const data = (await this.request("GET", `/messages/${uid}${q({ folder, account })}`)) as {
        message: MessageBody;
      };
      return data.message;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async search(opts: {
    folder: string;
    limit: number;
    q?: string;
    from?: string;
    subject?: string;
    unseen?: boolean;
    account?: string;
  }) {
    const qs = q({
      folder: opts.folder,
      limit: String(opts.limit),
      q: opts.q,
      from: opts.from,
      subject: opts.subject,
      unseen: opts.unseen === undefined ? undefined : String(opts.unseen),
      account: opts.account,
    });
    const data = (await this.request("GET", `/search${qs}`)) as { messages: MessageHeader[] };
    return data.messages;
  }

  async move(uid: number, from: string, to: string, account?: string) {
    return (await this.request("POST", `/messages/${uid}/move`, { from, to, account })) as {
      uid: number;
      from: string;
      to: string;
      account: string;
    };
  }

  async setFlags(uid: number, update: FlagUpdate) {
    return (await this.request("POST", `/messages/${uid}/flags`, update)) as {
      uid: number;
      folder: string;
      flags: string[];
      account: string;
    };
  }

  async sendMail(opts: SendOpts) {
    return (await this.request("POST", "/messages/send", opts)) as { messageId: string; account: string };
  }

  async getFolderProfile() {
    const data = (await this.request("GET", "/folder-profile")) as { profile: FolderProfile | null };
    return data.profile;
  }

  async saveFolderProfile(profile: FolderProfile) {
    const data = (await this.request("PUT", "/folder-profile", profile)) as { profile: FolderProfile };
    return data.profile;
  }

  async applyFolderProfile(opts: { dryRun: boolean; account?: string; profile?: FolderProfile }) {
    return (await this.request("POST", "/folder-profile/apply", {
      dry_run: opts.dryRun,
      account: opts.account,
      profile: opts.profile,
    })) as FolderApplyResult;
  }

  async listRules() {
    const data = (await this.request("GET", "/rules")) as { rules: RuleDef[] };
    return data.rules;
  }

  async applyRules(opts: { dryRun: boolean; account?: string }) {
    return (await this.request("POST", "/rules/apply", {
      dry_run: opts.dryRun,
      account: opts.account,
    })) as RuleApplyResult;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.cfg.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new HttpError(
        503,
        `Imaplane HTTP is not reachable at ${this.cfg.baseUrl} (${err instanceof Error ? err.message : String(err)}). Start it with \`imaplane start\` or \`npm start\`.`,
      );
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: text };
      }
    }
    if (!res.ok) {
      const message =
        json && typeof json === "object" && json !== null && "error" in json
          ? String((json as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new HttpError(res.status, message);
    }
    return json;
  }
}

function q(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export function loadBridgeClientConfig(): BridgeClientConfig {
  const host = (process.env.HOST ?? "127.0.0.1").trim();
  const port = (process.env.PORT ?? "8787").trim();
  const baseUrl = (process.env.BRIDGE_URL ?? process.env.IMAPLANE_URL ?? `http://${host}:${port}/v1`).replace(
    /\/$/,
    "",
  );
  const token = (process.env.BRIDGE_TOKEN ?? process.env.IMAPLANE_TOKEN ?? "").trim();
  if (token.length < 16) {
    throw new Error("MCP needs BRIDGE_TOKEN in the environment or .env (openssl rand -hex 32).");
  }
  return { baseUrl, token };
}
