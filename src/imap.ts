import { ImapFlow, type FetchMessageObject, type ListResponse, type MailboxLockObject } from "imapflow";
import { simpleParser, type Attachment } from "mailparser";
import { normalizeFolder } from "./folders.js";
import { htmlToPlain, sanitizeMessageHtml } from "./html.js";
import { log } from "./log.js";
import { buildSearchQuery } from "./searchQuery.js";
import {
  HttpError,
  type EnvelopeAddress,
  type FlagUpdate,
  type FolderInfo,
  type ImapHealth,
  type ListMessagesOpts,
  type MessageBody,
  type MessageHeader,
  type SearchOpts,
} from "./types.js";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const FETCH_SOURCE_MAX = 2_000_000;

export type ImapConnectionOptions = {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

/** Single-account IMAP pool. Multi-account lives in ImaplaneService. */
export class ImapBackend {
  private client: ImapFlow | null = null;
  private delimiter = "/";
  private status: ImapHealth["status"] = "disconnected";
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private stopping = false;
  private opChain: Promise<unknown> = Promise.resolve();
  private generation = 0;

  constructor(private readonly opts: ImapConnectionOptions) {}

  start(): void {
    this.stopping = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.generation += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    this.status = "disconnected";
    if (client) {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  health(): ImapHealth {
    const connected = Boolean(this.client?.usable);
    return {
      connected,
      status: connected ? "connected" : this.status,
    };
  }

  async listFolders(): Promise<FolderInfo[]> {
    return this.runExclusive(async (client) => {
      let boxes: ListResponse[];
      try {
        boxes = await client.list({
          statusQuery: { messages: true, unseen: true },
        });
      } catch {
        boxes = await client.list();
      }
      this.captureDelimiter(boxes);
      return boxes.map((box) => ({
        path: box.path,
        name: box.name,
        delimiter: box.delimiter || this.delimiter,
        specialUse: box.specialUse ?? null,
        flags: flagList(box.flags),
        messages: box.status?.messages,
        unseen: box.status?.unseen,
      }));
    });
  }

  async createFolder(name: string): Promise<{ path: string; created: boolean }> {
    const path = this.normalize(name);
    return this.runExclusive(async (client) => {
      try {
        const result = await client.mailboxCreate(path);
        return { path: result.path, created: result.created };
      } catch (err) {
        throw mapImapError(err, `could not create folder ${path}`);
      }
    });
  }

  async listMessages(opts: ListMessagesOpts): Promise<MessageHeader[]> {
    const folder = this.normalize(opts.folder);
    return this.withMailbox(folder, async (client) => {
      if (opts.unseen) {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];
        const slice = newestUids(uids, opts.limit);
        return this.fetchHeaders(client, folder, slice);
      }

      const exists = client.mailbox ? client.mailbox.exists : 0;
      if (exists === 0) return [];
      const start = Math.max(1, exists - opts.limit + 1);
      const headers: MessageHeader[] = [];
      for await (const msg of client.fetch(`${start}:${exists}`, headerQuery())) {
        headers.push(toHeader(folder, msg));
      }
      return headers.sort(byUidDesc).slice(0, opts.limit);
    });
  }

  async getMessage(uid: number, folderName: string): Promise<MessageBody | null> {
    const folder = this.normalize(folderName);
    return this.withMailbox(folder, async (client) => {
      let msg: FetchMessageObject | false;
      try {
        msg = await client.fetchOne(
          uid,
          {
            uid: true,
            flags: true,
            envelope: true,
            size: true,
            source: { maxLength: FETCH_SOURCE_MAX },
          },
          { uid: true },
        );
      } catch (err) {
        throw mapImapError(err, `could not fetch uid ${uid}`);
      }
      if (!msg) return null;

      const header = toHeader(folder, msg);
      log.info("read message", { folder, uid, from: header.from, subject: header.subject });

      if (!msg.source) {
        return {
          ...header,
          text: null,
          html: null,
          attachments: [],
        };
      }

      const parsed = await simpleParser(msg.source);
      return {
        ...header,
        subject: header.subject ?? parsed.subject ?? null,
        date: header.date ?? (parsed.date ? parsed.date.toISOString() : null),
        text: parsed.text?.trim() || htmlToPlain(typeof parsed.html === "string" ? parsed.html : null),
        html: sanitizeMessageHtml(typeof parsed.html === "string" ? parsed.html : null),
        attachments: (parsed.attachments ?? []).map(toAttachmentMeta),
      };
    });
  }

  async search(opts: SearchOpts): Promise<MessageHeader[]> {
    const folder = this.normalize(opts.folder);
    const query = buildSearchQuery(opts);
    return this.withMailbox(folder, async (client) => {
      let uids: number[] = [];
      try {
        uids = (await client.search(query, { uid: true })) || [];
      } catch (err) {
        throw mapImapError(err, "search failed");
      }
      const slice = newestUids(uids, opts.limit);
      const headers = await this.fetchHeaders(client, folder, slice);
      log.info("search", {
        folder,
        q: opts.q,
        from: opts.from,
        subject: opts.subject,
        unseen: opts.unseen,
        hits: headers.length,
      });
      return headers;
    });
  }

  async move(uid: number, fromName: string, toName: string): Promise<{ uid: number; from: string; to: string }> {
    const from = this.normalize(fromName);
    const to = this.normalize(toName);
    if (from === to) {
      throw new HttpError(400, "from and to folders are the same");
    }
    return this.withMailbox(from, async (client) => {
      try {
        const result = await client.messageMove(uid, to, { uid: true });
        if (result === false) {
          throw new HttpError(404, `message ${uid} not found in ${from}`);
        }
        log.info("moved message", { uid, from, to });
        return { uid, from, to };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw mapImapError(err, `could not move uid ${uid} to ${to}`);
      }
    });
  }

  async setFlags(uid: number, update: FlagUpdate): Promise<{ uid: number; folder: string; flags: string[] }> {
    const folder = this.normalize(update.folder);
    return this.withMailbox(folder, async (client) => {
      try {
        if (update.add.length) {
          const added = await client.messageFlagsAdd(uid, update.add, { uid: true });
          if (added === false) throw new HttpError(404, `message ${uid} not found in ${folder}`);
        }
        if (update.remove.length) {
          const removed = await client.messageFlagsRemove(uid, update.remove, { uid: true });
          if (removed === false) throw new HttpError(404, `message ${uid} not found in ${folder}`);
        }
        const msg = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
        if (!msg) throw new HttpError(404, `message ${uid} not found in ${folder}`);
        const flags = flagList(msg.flags);
        log.info("updated flags", { uid, folder, flags, add: update.add, remove: update.remove });
        return { uid, folder, flags };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw mapImapError(err, `could not update flags for uid ${uid}`);
      }
    });
  }

  private normalize(name: string): string {
    return normalizeFolder(name, this.delimiter);
  }

  private async fetchHeaders(client: ImapFlow, folder: string, uids: number[]): Promise<MessageHeader[]> {
    if (uids.length === 0) return [];
    const headers: MessageHeader[] = [];
    for await (const msg of client.fetch(uids, headerQuery(), { uid: true })) {
      headers.push(toHeader(folder, msg));
    }
    return headers.sort(byUidDesc);
  }

  private withMailbox<T>(folder: string, fn: (client: ImapFlow, lock: MailboxLockObject) => Promise<T>): Promise<T> {
    return this.runExclusive(async (client) => {
      let lock: MailboxLockObject;
      try {
        lock = await client.getMailboxLock(folder);
      } catch (err) {
        throw mapImapError(err, `mailbox not available: ${folder}`);
      }
      try {
        return await fn(client, lock);
      } finally {
        lock.release();
      }
    });
  }

  private runExclusive<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const client = await this.connect();
      if (!client.usable) {
        throw new HttpError(503, "imap disconnected");
      }
      try {
        return await fn(client);
      } catch (err) {
        if (isConnectionError(err)) {
          log.warn("imap connection error during op", { error: errorMessage(err) });
          this.markDisconnected(client);
          throw new HttpError(503, "imap disconnected");
        }
        throw err;
      }
    };
    const next = this.opChain.then(run, run);
    this.opChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client?.usable) {
      this.status = "connected";
      return this.client;
    }
    if (this.stopping) {
      throw new HttpError(503, "imap shutting down");
    }

    this.status = "connecting";
    const generation = this.generation;
    const client = new ImapFlow({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.secure,
      auth: {
        user: this.opts.user,
        pass: this.opts.password,
      },
      logger: false,
      tls: { rejectUnauthorized: true },
    });

    client.on("error", (err) => {
      log.error("imap error", { error: errorMessage(err) });
      this.markDisconnected(client);
    });
    client.on("close", () => {
      this.markDisconnected(client);
    });

    try {
      await client.connect();
    } catch (err) {
      this.status = "disconnected";
      this.scheduleReconnect();
      throw new HttpError(503, `imap connect failed: ${errorMessage(err)}`);
    }

    if (this.stopping || generation !== this.generation) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
      throw new HttpError(503, "imap shutting down");
    }

    this.client = client;
    this.status = "connected";
    this.reconnectDelay = RECONNECT_MIN_MS;
    log.info("imap connected", { account: this.opts.name, host: this.opts.host, user: this.opts.user });

    try {
      const boxes = await client.list();
      this.captureDelimiter(boxes);
    } catch (err) {
      log.warn("could not list mailboxes after connect", { error: errorMessage(err) });
    }

    return client;
  }

  private captureDelimiter(boxes: ListResponse[]): void {
    const found = boxes.find((box) => box.delimiter);
    if (found?.delimiter) this.delimiter = found.delimiter;
  }

  private markDisconnected(client: ImapFlow): void {
    if (this.client === client) this.client = null;
    if (this.status !== "connecting") this.status = "disconnected";
    if (!this.stopping) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => {
        log.warn("imap reconnect failed", { error: errorMessage(err) });
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

function headerQuery() {
  return { uid: true, flags: true, envelope: true, size: true } as const;
}

function toHeader(folder: string, msg: FetchMessageObject): MessageHeader {
  const flags = flagList(msg.flags);
  const envelope = msg.envelope;
  return {
    uid: msg.uid,
    folder,
    from: addresses(envelope?.from),
    to: addresses(envelope?.to),
    cc: addresses(envelope?.cc),
    subject: envelope?.subject ?? null,
    date: envelope?.date ? envelope.date.toISOString() : null,
    messageId: envelope?.messageId ?? null,
    flags,
    unseen: !flags.includes("\\Seen"),
    size: typeof msg.size === "number" ? msg.size : null,
  };
}

type ImapAddress = { name?: string | null; address?: string | null };

function addresses(list: ImapAddress[] | undefined): EnvelopeAddress[] {
  if (!list) return [];
  return list.map((item) => ({
    name: item.name ?? null,
    address: item.address ?? null,
  }));
}

function toAttachmentMeta(att: Attachment) {
  return {
    filename: att.filename ?? null,
    contentType: att.contentType || "application/octet-stream",
    size: typeof att.size === "number" ? att.size : att.content?.length ?? null,
    contentId: att.contentId ?? null,
    contentDisposition: att.contentDisposition ?? null,
  };
}

function flagList(flags: Set<string> | string[] | undefined): string[] {
  if (!flags) return [];
  return [...flags];
}

function newestUids(uids: number[], limit: number): number[] {
  return [...uids].sort((a, b) => a - b).slice(-limit);
}

function byUidDesc(a: MessageHeader, b: MessageHeader): number {
  return b.uid - a.uid;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isConnectionError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("closed") ||
    msg.includes("socket") ||
    msg.includes("not connected") ||
    msg.includes("connection") ||
    msg.includes("timeout") ||
    msg.includes("econn")
  );
}

function mapImapError(err: unknown, fallback: string): HttpError {
  if (err instanceof HttpError) return err;
  const msg = errorMessage(err);
  const lower = msg.toLowerCase();
  if (lower.includes("not found") || lower.includes("no such") || lower.includes("nonexistent")) {
    return new HttpError(404, msg);
  }
  if (lower.includes("already exists")) {
    return new HttpError(409, msg);
  }
  if (lower.includes("authentication") || lower.includes("invalid credentials")) {
    return new HttpError(503, "imap authentication failed");
  }
  return new HttpError(502, `${fallback}: ${msg}`);
}
