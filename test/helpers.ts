import type { AppConfig } from "../src/config.js";
import { ICLOUD_PRESET } from "../src/providers.js";
import type {
  AccountInfo,
  FolderProfile,
  MailBackend,
  MessageBody,
  MessageHeader,
  RuleDef,
  SendOpts,
} from "../src/types.js";

export const token = "test-token-0123456789ab";

export const sample: MessageHeader = {
  uid: 42,
  folder: "INBOX",
  from: [{ name: "Ada", address: "ada@example.com" }],
  to: [],
  cc: [],
  subject: "Hello",
  date: "2026-01-02T03:04:05.000Z",
  messageId: "<1@example.com>",
  flags: [],
  unseen: true,
  size: 100,
};

export const body: MessageBody = {
  ...sample,
  text: "Hello",
  html: "<p>Hello</p>",
  attachments: [],
};

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    rootDir: ".",
    host: "127.0.0.1",
    port: 0,
    bridgeToken: token,
    defaultAccount: "icloud",
    sendEnabled: false,
    sweeps: { enabled: false, intervalMs: 15 * 60_000 },
    accounts: [
      {
        name: "icloud",
        provider: "icloud",
        user: "user@icloud.com",
        password: "xxxx",
        imap: { ...ICLOUD_PRESET.imap },
        smtp: { ...ICLOUD_PRESET.smtp },
        sendEnabled: false,
      },
    ],
    folderProfiles: {},
    rules: [],
    ...overrides,
  };
}

export class MockBackend implements MailBackend {
  moved: unknown[] = [];
  flags: unknown[] = [];
  created: string[] = [];
  sent: SendOpts[] = [];
  sendEnabled = false;
  folders: string[] = ["INBOX", "Important"];
  profile: FolderProfile | null = null;
  rules: RuleDef[] = [];
  messages: MessageHeader[] = [sample];
  bodies = new Map<number, MessageBody>([[42, body]]);

  start(): void {}
  async stop(): Promise<void> {}
  health() {
    return {
      connected: true,
      status: "connected" as const,
      send_enabled: this.sendEnabled,
      default_account: "icloud",
      accounts: [
        {
          name: "icloud",
          provider: "icloud" as const,
          connected: true,
          status: "connected" as const,
          send_enabled: this.sendEnabled,
        },
      ],
    };
  }
  listAccounts(): AccountInfo[] {
    return [
      {
        name: "icloud",
        provider: "icloud",
        user: "user@icloud.com",
        imap_host: "imap.mail.me.com",
        send_enabled: this.sendEnabled,
        default: true,
      },
    ];
  }
  async listFolders() {
    return this.folders.map((path) => ({
      path,
      name: path.split("/").pop() ?? path,
      delimiter: "/",
      specialUse: path === "INBOX" ? "\\Inbox" : null,
      flags: [],
      messages: 1,
      unseen: 1,
    }));
  }
  async createFolder(name: string) {
    this.created.push(name);
    this.folders.push(name);
    return { path: name, created: true };
  }
  async listMessages() {
    return this.messages;
  }
  async getMessage(uid: number) {
    return this.bodies.get(uid) ?? null;
  }
  async search() {
    return this.messages;
  }
  async move(uid: number, from: string, to: string, account?: string) {
    this.moved.push({ uid, from, to, account: account ?? "icloud" });
    return { uid, from, to, account: account ?? "icloud" };
  }
  async setFlags(uid: number, update: { folder: string; add: string[]; remove: string[]; account?: string }) {
    this.flags.push({ uid, ...update });
    return { uid, folder: update.folder, flags: ["\\Seen"], account: update.account ?? "icloud" };
  }
  async sendMail(opts: SendOpts) {
    if (!this.sendEnabled) throw new Error("sending is disabled");
    this.sent.push(opts);
    return { messageId: "<sent@test>", account: opts.account ?? "icloud" };
  }
  async getFolderProfile() {
    return this.profile;
  }
  async saveFolderProfile(profile: FolderProfile) {
    this.profile = profile;
    return profile;
  }
  async applyFolderProfile(opts: { dryRun: boolean; account?: string; profile?: FolderProfile }) {
    const profile = opts.profile ?? this.profile;
    const items =
      profile?.folders.map((f) => ({
        path: f.path,
        action: this.folders.includes(f.path) ? ("exists" as const) : ("create" as const),
      })) ?? [];
    if (!opts.dryRun) {
      for (const item of items) {
        if (item.action === "create") this.created.push(item.path);
      }
    }
    return { dry_run: opts.dryRun, account: opts.account ?? "icloud", items };
  }
  async listRules() {
    return this.rules;
  }
  async applyRules(opts: { dryRun: boolean; account?: string }) {
    return { dry_run: opts.dryRun, hits: [], scanned: 0 };
  }
}
