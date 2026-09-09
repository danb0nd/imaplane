import { parseBool, parseLimit, parseUid } from "./folders.js";
import { EXAMPLE_BOTMAIL_PROFILE } from "./folderProfile.js";
import { SERVICE } from "./version.js";
import { HttpError, type MailBackend, type MessageBody } from "./types.js";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type MailTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (backend: MailBackend, args: Record<string, unknown>) => Promise<unknown>;
};

const ACCOUNT = {
  type: "string",
  description: "Named account (optional; default account if omitted).",
};

const FOLDER = {
  type: "string",
  description: "IMAP folder path. Default INBOX. Nested folders use / e.g. Triage/Action.",
};

const UID = { type: "integer", minimum: 1, description: "IMAP UID in that folder." };

const LIMIT = {
  type: "integer",
  minimum: 1,
  maximum: 200,
  description: "Max messages to return (default 30, cap 200).",
};

const READ_TOOLS: MailTool[] = [
  {
    name: "mail_health",
    description: "Liveness of the local Imaplane HTTP+IMAP bridge. Does not send.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (backend) => {
      const imap = await backend.health();
      return { ok: true, service: SERVICE, imap, send_enabled: Boolean(imap.send_enabled) };
    },
  },
  {
    name: "mail_accounts",
    description: "List configured IMAP accounts (name, provider, host). Pass account= on other tools to select one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (backend) => ({ accounts: await backend.listAccounts() }),
  },
  {
    name: "mail_folders",
    description: "List mailboxes/folders with message and unseen counts when the server provides them.",
    inputSchema: { type: "object", properties: { account: ACCOUNT }, additionalProperties: false },
    run: async (backend, args) => ({ folders: await backend.listFolders(str(args.account, "account") || undefined) }),
  },
  {
    name: "mail_create_folder",
    description:
      "Create one mailbox path. If the user asked how to organise folders, do NOT invent a tree: interview, propose, confirm, then create (see mail_apply_folder_profile).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: 'Folder path, e.g. "Triage/Action".' },
        account: ACCOUNT,
      },
      required: ["name"],
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const name = str(args.name, "name");
      if (!name) throw new HttpError(400, "name is required");
      return backend.createFolder(name, str(args.account, "account") || undefined);
    },
  },
  {
    name: "mail_folder_profile",
    description:
      "Get the saved folder profile (intended folders + purpose labels + protect list). Empty if none saved.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (backend) => ({
      profile: await backend.getFolderProfile(),
      example: EXAMPLE_BOTMAIL_PROFILE,
    }),
  },
  {
    name: "mail_save_folder_profile",
    description:
      "Save a folder profile after the user confirms a tree. protect = personal folders never to clobber (e.g. Important).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        protect: { type: "array", items: { type: "string" } },
        folders: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, purpose: { type: "string" } },
          },
        },
      },
      required: ["folders"],
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const folders = Array.isArray(args.folders)
        ? args.folders
            .map((item) => {
              if (item && typeof item === "object" && "path" in item) {
                const row = item as { path?: unknown; purpose?: unknown };
                return { path: String(row.path ?? ""), purpose: String(row.purpose ?? "") };
              }
              return { path: "", purpose: "" };
            })
            .filter((f) => f.path)
        : [];
      const protect = Array.isArray(args.protect)
        ? args.protect.filter((p): p is string => typeof p === "string")
        : [];
      return {
        profile: await backend.saveFolderProfile({
          name: str(args.name, "name") || "default",
          protect,
          folders,
        }),
      };
    },
  },
  {
    name: "mail_apply_folder_profile",
    description:
      "Create missing folders from the saved (or provided) profile. Never deletes or renames. Skips protect-listed names. Prefer dry_run=true first.",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Default true. Set false only after the user confirms." },
        account: ACCOUNT,
      },
      additionalProperties: false,
    },
    run: async (backend, args) =>
      backend.applyFolderProfile({
        dryRun: parseBool(args.dry_run) ?? true,
        account: str(args.account, "account") || undefined,
      }),
  },
  {
    name: "mail_list",
    description:
      "List message headers (uid, from, subject, date, flags, unseen). For inbox triage pass unseen=true. Newest first. Does not return bodies.",
    inputSchema: {
      type: "object",
      properties: {
        folder: FOLDER,
        limit: LIMIT,
        unseen: { type: "boolean", description: "If true, only unseen messages. Prefer true for triage." },
        account: ACCOUNT,
      },
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const folder = str(args.folder, "folder") || "INBOX";
      const limit = parseLimit(args.limit, 30);
      const unseen = parseBool(args.unseen) ?? true;
      const account = str(args.account, "account") || undefined;
      const messages = await backend.listMessages({ folder, limit, unseen, account });
      return { folder, messages };
    },
  },
  {
    name: "mail_read",
    description:
      "Read one message: headers, plain text, attachment metadata. HTML omitted unless include_html=true. Does not download attachment bytes.",
    inputSchema: {
      type: "object",
      properties: {
        uid: UID,
        folder: FOLDER,
        include_html: { type: "boolean", description: "Include sanitized HTML. Default false." },
        account: ACCOUNT,
      },
      required: ["uid"],
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const uid = asUid(args.uid);
      const folder = str(args.folder, "folder") || "INBOX";
      const message = await backend.getMessage(uid, folder, str(args.account, "account") || undefined);
      if (!message) throw new HttpError(404, `message ${uid} not found in ${folder}`);
      return { message: shapeRead(message, parseBool(args.include_html) === true) };
    },
  },
  {
    name: "mail_search",
    description:
      "IMAP SEARCH in a folder. Free text q matches subject/from/body. Helpers: q=unseen, q=from:addr, q=subject:text, or from/subject/unseen fields.",
    inputSchema: {
      type: "object",
      properties: {
        folder: FOLDER,
        q: { type: "string", description: "Free-text or helper (unseen, from:, subject:)." },
        from: { type: "string" },
        subject: { type: "string" },
        unseen: { type: "boolean" },
        limit: LIMIT,
        account: ACCOUNT,
      },
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const folder = str(args.folder, "folder") || "INBOX";
      const messages = await backend.search({
        folder,
        limit: parseLimit(args.limit, 30),
        q: str(args.q, "q") || undefined,
        from: str(args.from, "from") || undefined,
        subject: str(args.subject, "subject") || undefined,
        unseen: parseBool(args.unseen),
        account: str(args.account, "account") || undefined,
      });
      return { folder, messages };
    },
  },
  {
    name: "mail_move",
    description:
      "Move a message to another folder. Does not mark \\Seen; call mail_flags after. Do not move into protect-listed personal folders unless the user explicitly asks.",
    inputSchema: {
      type: "object",
      properties: {
        uid: UID,
        from: { type: "string", description: "Source folder." },
        to: { type: "string", description: "Destination folder." },
        account: ACCOUNT,
      },
      required: ["uid", "from", "to"],
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const uid = asUid(args.uid);
      const from = str(args.from, "from");
      const to = str(args.to, "to");
      if (!from || !to) throw new HttpError(400, "from and to are required");
      return backend.move(uid, from, to, str(args.account, "account") || undefined);
    },
  },
  {
    name: "mail_flags",
    description: 'Add or remove IMAP flags. To mark read: add ["\\\\Seen"].',
    inputSchema: {
      type: "object",
      properties: {
        uid: UID,
        folder: FOLDER,
        add: { type: "array", items: { type: "string" }, description: 'Flags to add, e.g. ["\\\\Seen"].' },
        remove: { type: "array", items: { type: "string" } },
        account: ACCOUNT,
      },
      required: ["uid", "folder"],
      additionalProperties: false,
    },
    run: async (backend, args) => {
      const uid = asUid(args.uid);
      const folder = str(args.folder, "folder");
      if (!folder) throw new HttpError(400, "folder is required");
      return backend.setFlags(uid, {
        folder,
        add: strList(args.add, "add"),
        remove: strList(args.remove, "remove"),
        account: str(args.account, "account") || undefined,
      });
    },
  },
  {
    name: "mail_rules_dry_run",
    description: "Preview file-based rules (from/domain/subject/unseen → move/flags) without changing mail.",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT },
      additionalProperties: false,
    },
    run: async (backend, args) =>
      backend.applyRules({ dryRun: true, account: str(args.account, "account") || undefined }),
  },
  {
    name: "mail_rules_apply",
    description: "Apply file-based rules (moves/flags). Prefer mail_rules_dry_run first.",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT },
      additionalProperties: false,
    },
    run: async (backend, args) =>
      backend.applyRules({ dryRun: false, account: str(args.account, "account") || undefined }),
  },
];

const SEND_TOOL: MailTool = {
  name: "mail_send",
  description:
    "Send mail via SMTP. Only registered when sending is explicitly enabled. Use only when the user clearly asks to send.",
  inputSchema: {
    type: "object",
    properties: {
      account: ACCOUNT,
      to: { type: "string", description: "Recipient email (or comma-separated)." },
      cc: { type: "string" },
      bcc: { type: "string" },
      subject: { type: "string" },
      text: { type: "string" },
      html: { type: "string" },
    },
    required: ["to", "subject"],
    additionalProperties: false,
  },
  run: async (backend, args) => {
    const to = str(args.to, "to");
    const subject = str(args.subject, "subject");
    if (!to || !subject) throw new HttpError(400, "to and subject are required");
    return backend.sendMail({
      account: str(args.account, "account") || undefined,
      to,
      cc: str(args.cc, "cc") || undefined,
      bcc: str(args.bcc, "bcc") || undefined,
      subject,
      text: str(args.text, "text") || undefined,
      html: str(args.html, "html") || undefined,
    });
  },
};

export function buildMailTools(sendEnabled: boolean): MailTool[] {
  return sendEnabled ? [...READ_TOOLS, SEND_TOOL] : READ_TOOLS;
}

/** Stable tool names with send disabled (default). */
export const MAIL_TOOLS = buildMailTools(false);
export const TOOL_NAMES = MAIL_TOOLS.map((t) => t.name);

function str(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  return value.trim();
}

function asUid(value: unknown): number {
  return parseUid(String(value ?? ""));
}

function strList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function shapeRead(message: MessageBody, includeHtml: boolean) {
  const { html, ...rest } = message;
  return includeHtml ? message : rest;
}
