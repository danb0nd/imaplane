import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeProfile } from "./config.js";
import { HttpError, type FolderApplyResult, type FolderInfo, type FolderProfile, type MailBackend } from "./types.js";

export const EXAMPLE_BOTMAIL_PROFILE: FolderProfile = {
  name: "botmail",
  protect: ["Important", "Follow Up", "Archive", "Sent Messages", "Drafts", "Junk", "Deleted Messages"],
  folders: [
    { path: "BotMail/InboxClear", purpose: "Seen and done; keep, but not in INBOX." },
    { path: "BotMail/Action", purpose: "The user needs to do something." },
    { path: "BotMail/Waiting", purpose: "Ball is in someone else's court." },
    { path: "BotMail/FYI", purpose: "Worth knowing, no action." },
    { path: "BotMail/Park", purpose: "Keep out of the way; not a to-do." },
    { path: "BotMail/Receipts", purpose: "Orders, invoices, payments, tickets." },
    { path: "BotMail/Noise", purpose: "Newsletters, marketing, alerts." },
    { path: "BotMail/DeleteQueue", purpose: "Candidates to drop later; do not trash during triage." },
  ],
};

export function isProtected(name: string, protect: string[]): boolean {
  const n = name.trim().toLowerCase();
  return protect.some((p) => {
    const needle = p.trim().toLowerCase();
    return n === needle || n.endsWith(`/${needle}`);
  });
}

export function loadFolderProfileFile(rootDir: string): FolderProfile | null {
  const p = path.join(rootDir, "folders.yaml");
  if (!fs.existsSync(p)) return null;
  const rec = (parseYaml(fs.readFileSync(p, "utf8")) ?? {}) as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : "default";
  return normalizeProfile(name, rec);
}

export function writeFolderProfileFile(rootDir: string, profile: FolderProfile): void {
  const p = path.join(rootDir, "folders.yaml");
  const body = stringifyYaml({
    name: profile.name,
    protect: profile.protect,
    folders: profile.folders,
  });
  fs.writeFileSync(p, body, { encoding: "utf8", mode: 0o644 });
}

export async function applyFolderProfile(
  backend: Pick<MailBackend, "listFolders" | "createFolder">,
  profile: FolderProfile,
  opts: { dryRun: boolean; account?: string },
): Promise<FolderApplyResult> {
  if (!profile.folders.length) {
    throw new HttpError(400, "folder profile has no folders");
  }
  const existing: FolderInfo[] = await backend.listFolders(opts.account);
  const existingPaths = new Set(existing.map((f) => f.path.toLowerCase()));
  const items: FolderApplyResult["items"] = [];

  for (const spec of profile.folders) {
    const pathName = spec.path.trim();
    if (!pathName) continue;
    const lower = pathName.toLowerCase();
    const leaf = pathName.split("/").pop() ?? pathName;
    if (isProtected(pathName, profile.protect) || isProtected(leaf, profile.protect)) {
      items.push({ path: pathName, action: "skipped_protected" });
      continue;
    }
    if (existingPaths.has(lower)) {
      items.push({ path: pathName, action: "exists" });
      continue;
    }
    if (opts.dryRun) {
      items.push({ path: pathName, action: "create" });
      continue;
    }
    const segments = pathName.split("/").filter(Boolean);
    let built = "";
    let last = { path: pathName, created: false };
    for (const segment of segments) {
      built = built ? `${built}/${segment}` : segment;
      if (existingPaths.has(built.toLowerCase())) continue;
      last = await backend.createFolder(built, opts.account);
      existingPaths.add((last.path || built).toLowerCase());
    }
    items.push({ path: last.path || pathName, action: "create", created: last.created });
  }

  return { dry_run: opts.dryRun, account: opts.account ?? "", items };
}
