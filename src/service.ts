import type { AccountConfig, AppConfig } from "./config.js";
import { applyFolderProfile, loadFolderProfileFile, writeFolderProfileFile } from "./folderProfile.js";
import { ImapBackend } from "./imap.js";
import { log } from "./log.js";
import { applyRules } from "./rules.js";
import { sendViaSmtp } from "./smtp.js";
import {
  HttpError,
  type AccountInfo,
  type FlagUpdate,
  type FolderProfile,
  type ImapHealth,
  type ListMessagesOpts,
  type MailBackend,
  type SearchOpts,
  type SendOpts,
} from "./types.js";

export class ImaplaneService implements MailBackend {
  private readonly pools = new Map<string, ImapBackend>();

  constructor(private readonly config: AppConfig) {
    for (const account of config.accounts) {
      this.pools.set(
        account.name,
        new ImapBackend({
          name: account.name,
          host: account.imap.host,
          port: account.imap.port,
          secure: account.imap.secure,
          user: account.user,
          password: account.password,
        }),
      );
    }
  }

  start(): void {
    for (const backend of this.pools.values()) backend.start();
  }

  async stop(): Promise<void> {
    await Promise.all([...this.pools.values()].map((b) => b.stop()));
  }

  health(): ImapHealth {
    const accounts = this.config.accounts.map((account) => {
      const h = this.pools.get(account.name)?.health() ?? { connected: false, status: "disconnected" as const };
      return {
        name: account.name,
        provider: account.provider,
        connected: h.connected,
        status: h.status,
        send_enabled: this.config.sendEnabled && account.sendEnabled,
      };
    });
    const any = accounts.some((a) => a.connected);
    const allDisconnected = accounts.every((a) => a.status === "disconnected");
    return {
      connected: any,
      status: any ? "connected" : allDisconnected ? "disconnected" : "connecting",
      send_enabled: this.config.sendEnabled,
      default_account: this.config.defaultAccount,
      accounts,
    };
  }

  listAccounts(): AccountInfo[] {
    return this.config.accounts.map((a) => ({
      name: a.name,
      provider: a.provider,
      user: a.user,
      imap_host: a.imap.host,
      send_enabled: this.config.sendEnabled && a.sendEnabled,
      default: a.name === this.config.defaultAccount,
    }));
  }

  async listFolders(account?: string) {
    return this.pool(account).listFolders();
  }

  async createFolder(name: string, account?: string) {
    return this.pool(account).createFolder(name);
  }

  async listMessages(opts: ListMessagesOpts) {
    return this.pool(opts.account).listMessages(opts);
  }

  async getMessage(uid: number, folder: string, account?: string) {
    return this.pool(account).getMessage(uid, folder);
  }

  async search(opts: SearchOpts) {
    return this.pool(opts.account).search(opts);
  }

  async move(uid: number, from: string, to: string, account?: string) {
    const name = this.resolveName(account);
    const result = await this.pool(name).move(uid, from, to);
    return { ...result, account: name };
  }

  async setFlags(uid: number, update: FlagUpdate) {
    const name = this.resolveName(update.account);
    const result = await this.pool(name).setFlags(uid, update);
    return { ...result, account: name };
  }

  async sendMail(opts: SendOpts) {
    if (!this.config.sendEnabled) {
      throw new HttpError(403, "sending is disabled (set send.enabled in imaplane.yaml)");
    }
    const account = this.account(opts.account);
    return sendViaSmtp(account, opts);
  }

  async getFolderProfile(): Promise<FolderProfile | null> {
    const fromFile = loadFolderProfileFile(this.config.rootDir);
    if (fromFile) return fromFile;
    const names = Object.keys(this.config.folderProfiles);
    if (names.length === 0) return null;
    return this.config.folderProfiles[names[0]!] ?? null;
  }

  async saveFolderProfile(profile: FolderProfile): Promise<FolderProfile> {
    writeFolderProfileFile(this.config.rootDir, profile);
    this.config.folderProfiles[profile.name] = profile;
    return profile;
  }

  async applyFolderProfile(opts: { dryRun: boolean; account?: string; profile?: FolderProfile }) {
    const profile = opts.profile ?? (await this.getFolderProfile());
    if (!profile) throw new HttpError(400, "no folder profile configured; save one first or pass profile in the body");
    const account = this.resolveName(opts.account);
    return applyFolderProfile(this, profile, { dryRun: opts.dryRun, account });
  }

  async listRules() {
    return this.config.rules;
  }

  async applyRules(opts: { dryRun: boolean; account?: string }) {
    return applyRules(this, this.config.rules, {
      dryRun: opts.dryRun,
      account: opts.account,
      defaultAccount: this.config.defaultAccount,
    });
  }

  private pool(account?: string): ImapBackend {
    const name = this.resolveName(account);
    const backend = this.pools.get(name);
    if (!backend) throw new HttpError(404, `unknown account: ${name}`);
    return backend;
  }

  private account(name?: string): AccountConfig {
    const resolved = this.resolveName(name);
    const account = this.config.accounts.find((a) => a.name === resolved);
    if (!account) throw new HttpError(404, `unknown account: ${resolved}`);
    return account;
  }

  private resolveName(account?: string): string {
    const name = account?.trim();
    return name || this.config.defaultAccount;
  }
}

export function startSweeps(service: ImaplaneService, config: AppConfig): () => void {
  if (!config.sweeps.enabled) return () => undefined;
  if (config.sweeps.cron) {
    log.info("sweeps enabled (cron)", { cron: config.sweeps.cron });
    const timer = setInterval(() => {
      void import("./cron.js").then(({ cronMatches }) => {
        if (!cronMatches(config.sweeps.cron!)) return;
        void runSweep(service);
      });
    }, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
  log.info("sweeps enabled", { intervalMs: config.sweeps.intervalMs });
  const timer = setInterval(() => {
    void runSweep(service);
  }, config.sweeps.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

async function runSweep(service: ImaplaneService): Promise<void> {
  try {
    const result = await service.applyRules({ dryRun: false });
    log.info("sweep applied", { hits: result.hits.length, scanned: result.scanned });
  } catch (err) {
    log.warn("sweep failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
