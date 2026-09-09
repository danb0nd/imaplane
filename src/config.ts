import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { parseDuration } from "./duration.js";
import { ICLOUD_PRESET, imapSockets, smtpSockets } from "./providers.js";
import type { FolderProfile, FolderSpec, RuleActions, RuleDef, RuleMatch } from "./types.js";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type ProviderKind = "icloud" | "imap";

export type AccountConfig = {
  name: string;
  provider: ProviderKind;
  user: string;
  password: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean };
  sendEnabled: boolean;
  folderProfile?: string;
};

export type SweepConfig = {
  enabled: boolean;
  intervalMs: number;
  cron?: string;
};

export type AppConfig = {
  rootDir: string;
  host: string;
  port: number;
  bridgeToken: string;
  defaultAccount: string;
  sendEnabled: boolean;
  sweeps: SweepConfig;
  accounts: AccountConfig[];
  folderProfiles: Record<string, FolderProfile>;
  rules: RuleDef[];
};

/** @deprecated use AppConfig */
export type Config = AppConfig;

export type LoadConfigOpts = {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  loadDotenv?: boolean;
};

export function interpolate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name: string) => (env[name] ?? "").trim());
}

function envStr(env: NodeJS.ProcessEnv, ...names: string[]): string {
  for (const name of names) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

export function envFileExists(root = defaultRootDir): boolean {
  return fs.existsSync(path.join(root, ".env"));
}

export function yamlPath(root: string): string | null {
  for (const name of ["imaplane.yaml", "imaplane.yml"]) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(opts: LoadConfigOpts = {}): AppConfig {
  const rootDir = opts.rootDir ?? defaultRootDir;
  if (opts.loadDotenv !== false && !opts.env) {
    dotenv.config({ path: path.join(rootDir, ".env") });
    dotenv.config();
  }
  const env = { ...(opts.env ?? process.env) };

  const file = yamlPath(rootDir);
  const rawYaml = file ? interpolate(fs.readFileSync(file, "utf8"), env) : "";
  const yaml = rawYaml ? asRecord(parseYaml(rawYaml)) : {};

  const host = (asString(yaml.host) || envStr(env, "HOST") || "127.0.0.1").trim();
  const port = Number(yaml.port ?? (envStr(env, "PORT") || "8787"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer 1-65535");
  }

  const bridgeToken = (asString(yaml.bridge_token) || envStr(env, "BRIDGE_TOKEN", "IMAPLANE_TOKEN")).trim();
  if (!bridgeToken) {
    throw new Error("Missing BRIDGE_TOKEN (or IMAPLANE_TOKEN). Run `imaplane init` or copy .env.example.");
  }
  if (bridgeToken.length < 16) {
    throw new Error("BRIDGE_TOKEN must be at least 16 characters (openssl rand -hex 32)");
  }

  const sendBlock = asRecord(yaml.send);
  const sendEnabled = asBool(sendBlock.enabled, asBool(envStr(env, "IMAPLANE_SEND"), false));

  const sweepBlock = asRecord(yaml.sweeps);
  const sweeps: SweepConfig = {
    enabled: asBool(sweepBlock.enabled, false),
    intervalMs: parseDuration(
      (sweepBlock.interval as string | number | undefined) ?? (envStr(env, "IMAPLANE_SWEEP_INTERVAL") || "15m"),
      15 * 60_000,
    ),
    cron: asString(sweepBlock.cron) || undefined,
  };

  const accounts = parseAccounts(yaml, env, sendEnabled);
  if (accounts.length === 0) {
    throw new Error(
      "No mail accounts configured. Add accounts to imaplane.yaml or set ICLOUD_USER + ICLOUD_APP_PASSWORD. Run `imaplane init`.",
    );
  }

  const defaultAccount =
    asString(yaml.default_account) || envStr(env, "IMAPLANE_DEFAULT_ACCOUNT") || accounts[0]!.name;
  if (!accounts.some((a) => a.name === defaultAccount)) {
    throw new Error(`default_account "${defaultAccount}" is not a configured account`);
  }

  const folderProfiles = parseFolderProfiles(yaml, rootDir);
  const rules = parseRules(yaml, rootDir);

  return {
    rootDir,
    host,
    port,
    bridgeToken,
    defaultAccount,
    sendEnabled,
    sweeps,
    accounts,
    folderProfiles,
    rules,
  };
}

function parseAccounts(yaml: Record<string, unknown>, env: NodeJS.ProcessEnv, globalSend: boolean): AccountConfig[] {
  const block = yaml.accounts;
  const out: AccountConfig[] = [];

  if (block && typeof block === "object" && !Array.isArray(block)) {
    for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
      out.push(parseAccount(name, asRecord(value), env, globalSend));
    }
  } else if (Array.isArray(block)) {
    for (const value of block) {
      const rec = asRecord(value);
      const name = asString(rec.name);
      if (!name) throw new Error("each account needs a name");
      out.push(parseAccount(name, rec, env, globalSend));
    }
  }

  if (out.length === 0) {
    const legacy = legacyIcloudAccount(env, globalSend);
    if (legacy) out.push(legacy);
  }
  return out;
}

function legacyIcloudAccount(env: NodeJS.ProcessEnv, globalSend: boolean): AccountConfig | null {
  const user = envStr(env, "ICLOUD_USER", "IMAPLANE_ICLOUD_USER");
  const password = envStr(env, "ICLOUD_APP_PASSWORD", "IMAPLANE_ICLOUD_PASSWORD");
  if (!user && !password) return null;
  if (!user || !password) {
    throw new Error("ICLOUD_USER and ICLOUD_APP_PASSWORD must both be set");
  }
  const host = envStr(env, "IMAP_HOST") || ICLOUD_PRESET.imap.host;
  const port = Number(envStr(env, "IMAP_PORT") || ICLOUD_PRESET.imap.port);
  const usingPreset = host === ICLOUD_PRESET.imap.host;
  return {
    name: "icloud",
    provider: usingPreset ? "icloud" : "imap",
    user,
    password,
    imap: { host, port: Number.isInteger(port) ? port : 993, secure: true },
    smtp: { ...ICLOUD_PRESET.smtp },
    sendEnabled: globalSend && asBool(envStr(env, "IMAPLANE_ICLOUD_SEND"), globalSend),
  };
}

function parseAccount(
  name: string,
  rec: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  globalSend: boolean,
): AccountConfig {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new Error(`invalid account name "${name}"`);
  }
  const providerRaw = (asString(rec.provider) || "imap").toLowerCase();
  const provider: ProviderKind = providerRaw === "icloud" ? "icloud" : "imap";
  const user = interpolate(asString(rec.user) || envStr(env, accountEnv(name, "USER")), env);
  const password = interpolate(
    asString(rec.password) || envStr(env, accountEnv(name, "PASSWORD"), accountEnv(name, "APP_PASSWORD")),
    env,
  );
  if (!user || !password) {
    throw new Error(`account ${name}: user and password are required (prefer \${ENV} in yaml)`);
  }

  const imapRec = asRecord(rec.imap);
  const smtpRec = asRecord(rec.smtp);
  const imap =
    provider === "icloud" && !asString(imapRec.host)
      ? { ...ICLOUD_PRESET.imap }
      : imapSockets({
          host: asString(imapRec.host) || (provider === "icloud" ? ICLOUD_PRESET.imap.host : ""),
          port: imapRec.port !== undefined ? Number(imapRec.port) : undefined,
          tls: imapRec.tls === undefined ? (imapRec.secure as boolean | undefined) : asBool(imapRec.tls, true),
        });
  if (!imap.host) throw new Error(`account ${name}: imap.host is required for provider imap`);

  const smtp =
    provider === "icloud" && !asString(smtpRec.host)
      ? { ...ICLOUD_PRESET.smtp }
      : smtpSockets({
          host: asString(smtpRec.host) || imap.host,
          port: smtpRec.port !== undefined ? Number(smtpRec.port) : undefined,
          tls: smtpRec.tls === undefined ? (smtpRec.secure as boolean | undefined) : asBool(smtpRec.tls, false),
        });

  const sendEnabled = globalSend && asBool(rec.send, globalSend);
  const folderProfile = asString(rec.folder_profile) || undefined;
  return { name, provider, user, password, imap, smtp, sendEnabled, folderProfile };
}

function accountEnv(name: string, suffix: string): string {
  return `IMAPLANE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
}

function parseFolderProfiles(yaml: Record<string, unknown>, rootDir: string): Record<string, FolderProfile> {
  const out: Record<string, FolderProfile> = {};
  const block = yaml.folder_profiles;
  if (block && typeof block === "object" && !Array.isArray(block)) {
    for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
      out[name] = normalizeProfile(name, asRecord(value));
    }
  }
  const extra = path.join(rootDir, "folders.yaml");
  if (fs.existsSync(extra)) {
    const doc = asRecord(parseYaml(fs.readFileSync(extra, "utf8")));
    const name = asString(doc.name) || "default";
    out[name] = normalizeProfile(name, doc);
  }
  return out;
}

export function normalizeProfile(name: string, rec: Record<string, unknown>): FolderProfile {
  const protect = Array.isArray(rec.protect) ? rec.protect.filter((p): p is string => typeof p === "string") : [];
  const foldersRaw = Array.isArray(rec.folders) ? rec.folders : [];
  const folders: FolderSpec[] = foldersRaw.map((item) => {
    if (typeof item === "string") return { path: item, purpose: "" };
    const r = asRecord(item);
    return { path: asString(r.path) || asString(r.name), purpose: asString(r.purpose) };
  }).filter((f) => f.path);
  return { name, protect, folders };
}

function parseRules(yaml: Record<string, unknown>, rootDir: string): RuleDef[] {
  const fromYaml = Array.isArray(yaml.rules) ? yaml.rules : [];
  const extraPath = path.join(rootDir, "rules.yaml");
  const extraDoc = extraPath && fs.existsSync(extraPath) ? asRecord(parseYaml(fs.readFileSync(extraPath, "utf8"))) : {};
  const extra = Array.isArray(extraDoc.rules) ? extraDoc.rules : Array.isArray(extraDoc) ? extraDoc : [];
  return [...fromYaml, ...extra].map((item, i) => normalizeRule(asRecord(item), i));
}

export function normalizeRule(rec: Record<string, unknown>, index: number): RuleDef {
  const match = asRecord(rec.match);
  const actions = asRecord(rec.actions);
  const name = asString(rec.name) || `rule-${index + 1}`;
  return {
    name,
    enabled: rec.enabled === undefined ? true : asBool(rec.enabled, true),
    account: asString(rec.account) || undefined,
    folder: asString(rec.folder) || "INBOX",
    limit: Number(rec.limit) > 0 ? Number(rec.limit) : 50,
    match: {
      unseen: match.unseen === undefined ? undefined : asBool(match.unseen),
      from: asString(match.from) || undefined,
      subject: asString(match.subject) || undefined,
      q: asString(match.q) || undefined,
    } satisfies RuleMatch,
    actions: {
      move: asString(actions.move) || undefined,
      add_flags: stringList(actions.add_flags ?? actions.addFlags),
      remove_flags: stringList(actions.remove_flags ?? actions.removeFlags),
    } satisfies RuleActions,
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export { defaultRootDir as rootDir };
