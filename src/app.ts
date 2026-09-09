import express, { type NextFunction, type Request, type Response } from "express";
import { bearerAuth } from "./auth.js";
import type { AppConfig } from "./config.js";
import { asStringList, parseBool, parseLimit, parseUid } from "./folders.js";
import { log } from "./log.js";
import { SERVICE, VERSION } from "./version.js";
import { HttpError, type FolderProfile, type MailBackend } from "./types.js";

export function createApp(backend: MailBackend, config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      log.info("http", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  const v1 = express.Router();
  v1.get(
    "/health",
    wrap(async (_req, res) => {
      res.json(await healthPayload(backend, config));
    }),
  );
  v1.use(bearerAuth(config.bridgeToken));

  v1.get(
    "/accounts",
    wrap(async (_req, res) => {
      res.json({ default: config.defaultAccount, accounts: await backend.listAccounts() });
    }),
  );

  v1.get(
    "/folders",
    wrap(async (req, res) => {
      const folders = await backend.listFolders(accountOf(req));
      res.json({ account: accountOf(req) ?? config.defaultAccount, folders });
    }),
  );

  v1.post(
    "/folders",
    wrap(async (req, res) => {
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      if (!name.trim()) throw new HttpError(400, 'body must include { "name": "Triage/Receipts" }');
      const result = await backend.createFolder(name, accountOf(req));
      res.status(result.created ? 201 : 200).json(result);
    }),
  );

  v1.get(
    "/folder-profile",
    wrap(async (_req, res) => {
      res.json({ profile: await backend.getFolderProfile() });
    }),
  );

  v1.put(
    "/folder-profile",
    wrap(async (req, res) => {
      const profile = asProfile(req.body);
      res.json({ profile: await backend.saveFolderProfile(profile) });
    }),
  );

  v1.post(
    "/folder-profile/apply",
    wrap(async (req, res) => {
      const dryRun = parseBool(req.body?.dry_run ?? req.body?.dryRun) ?? false;
      const profile = req.body?.profile ? asProfile(req.body.profile) : undefined;
      const result = await backend.applyFolderProfile({
        dryRun,
        account: accountOf(req),
        profile,
      });
      res.json(result);
    }),
  );

  if (config.sendEnabled) {
    v1.post(
      "/messages/send",
      wrap(async (req, res) => {
        const result = await backend.sendMail({
          account: accountOf(req),
          to: req.body?.to,
          cc: req.body?.cc,
          bcc: req.body?.bcc,
          subject: typeof req.body?.subject === "string" ? req.body.subject : "",
          text: typeof req.body?.text === "string" ? req.body.text : undefined,
          html: typeof req.body?.html === "string" ? req.body.html : undefined,
        });
        res.status(202).json(result);
      }),
    );
  }

  v1.get(
    "/messages",
    wrap(async (req, res) => {
      const folder = queryString(req.query.folder) ?? "INBOX";
      const limit = parseLimit(req.query.limit);
      const unseen = parseBool(req.query.unseen);
      const account = accountOf(req);
      const messages = await backend.listMessages({ folder, limit, unseen, account });
      res.json({ account: account ?? config.defaultAccount, folder, messages });
    }),
  );

  v1.get(
    "/messages/:uid",
    wrap(async (req, res) => {
      const uid = parseUid(String(req.params.uid));
      const folder = queryString(req.query.folder) ?? "INBOX";
      const account = accountOf(req);
      const message = await backend.getMessage(uid, folder, account);
      if (!message) throw new HttpError(404, `message ${uid} not found in ${folder}`);
      res.json({ message });
    }),
  );

  v1.post(
    "/messages/:uid/move",
    wrap(async (req, res) => {
      const uid = parseUid(String(req.params.uid));
      const from = typeof req.body?.from === "string" ? req.body.from : "";
      const to = typeof req.body?.to === "string" ? req.body.to : "";
      if (!from.trim() || !to.trim()) {
        throw new HttpError(400, 'body must include { "from": "INBOX", "to": "Triage/Action" }');
      }
      const result = await backend.move(uid, from, to, accountOf(req));
      res.json(result);
    }),
  );

  v1.post(
    "/messages/:uid/flags",
    wrap(async (req, res) => {
      const uid = parseUid(String(req.params.uid));
      const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
      if (!folder.trim()) throw new HttpError(400, 'body must include { "folder": "INBOX", "add": [], "remove": [] }');
      const result = await backend.setFlags(uid, {
        folder,
        add: asStringList(req.body?.add, "add"),
        remove: asStringList(req.body?.remove, "remove"),
        account: accountOf(req),
      });
      res.json(result);
    }),
  );

  v1.get(
    "/search",
    wrap(async (req, res) => {
      const folder = queryString(req.query.folder) ?? "INBOX";
      const account = accountOf(req);
      const messages = await backend.search({
        folder,
        limit: parseLimit(req.query.limit),
        q: queryString(req.query.q),
        from: queryString(req.query.from),
        subject: queryString(req.query.subject),
        unseen: parseBool(req.query.unseen),
        account,
      });
      res.json({ account: account ?? config.defaultAccount, folder, messages });
    }),
  );

  v1.get(
    "/rules",
    wrap(async (_req, res) => {
      res.json({ rules: await backend.listRules() });
    }),
  );

  v1.post(
    "/rules/apply",
    wrap(async (req, res) => {
      const dryRun = parseBool(req.body?.dry_run ?? req.body?.dryRun) ?? true;
      const result = await backend.applyRules({ dryRun, account: accountOf(req) });
      res.json(result);
    }),
  );

  app.get(
    "/health",
    wrap(async (_req, res) => {
      res.json(await healthPayload(backend, config));
    }),
  );
  app.use("/v1", v1);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid json" });
      return;
    }
    log.error("unhandled", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res).catch(next);
  };
}

async function healthPayload(backend: MailBackend, config: AppConfig) {
  const imap = await backend.health();
  return {
    ok: true,
    service: SERVICE,
    version: VERSION,
    send_enabled: config.sendEnabled,
    default_account: config.defaultAccount,
    imap,
  };
}

function accountOf(req: Request): string | undefined {
  const q = queryString(req.query.account);
  if (q) return q;
  if (req.body && typeof req.body === "object" && typeof req.body.account === "string") {
    return req.body.account;
  }
  return undefined;
}

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function asProfile(body: unknown): FolderProfile {
  if (!body || typeof body !== "object") throw new HttpError(400, "profile object required");
  const rec = body as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : "default";
  const protect = Array.isArray(rec.protect)
    ? rec.protect.filter((p): p is string => typeof p === "string")
    : [];
  const folders = Array.isArray(rec.folders)
    ? rec.folders
        .map((item) => {
          if (typeof item === "string") return { path: item, purpose: "" };
          if (item && typeof item === "object" && "path" in item) {
            const row = item as { path?: unknown; purpose?: unknown };
            return {
              path: String(row.path ?? ""),
              purpose: typeof row.purpose === "string" ? row.purpose : "",
            };
          }
          return { path: "", purpose: "" };
        })
        .filter((f) => f.path)
    : [];
  if (!folders.length) throw new HttpError(400, "profile.folders is required");
  return { name, protect, folders };
}
