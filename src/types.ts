export type EnvelopeAddress = {
  name: string | null;
  address: string | null;
};

export type MessageFlags = string[];

export type FolderInfo = {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  flags: string[];
  messages?: number;
  unseen?: number;
};

export type MessageHeader = {
  uid: number;
  folder: string;
  from: EnvelopeAddress[];
  to: EnvelopeAddress[];
  cc: EnvelopeAddress[];
  subject: string | null;
  date: string | null;
  messageId: string | null;
  flags: MessageFlags;
  unseen: boolean;
  size: number | null;
};

export type AttachmentMeta = {
  filename: string | null;
  contentType: string;
  size: number | null;
  contentId: string | null;
  contentDisposition: string | null;
};

export type MessageBody = MessageHeader & {
  text: string | null;
  html: string | null;
  attachments: AttachmentMeta[];
};

export type ListMessagesOpts = {
  folder: string;
  limit: number;
  unseen?: boolean;
  account?: string;
};

export type SearchOpts = {
  folder: string;
  limit: number;
  q?: string;
  from?: string;
  subject?: string;
  unseen?: boolean;
  account?: string;
};

export type FlagUpdate = {
  folder: string;
  add: string[];
  remove: string[];
  account?: string;
};

export type AccountHealth = {
  name: string;
  provider: "icloud" | "imap";
  connected: boolean;
  status: "connected" | "connecting" | "disconnected";
  send_enabled: boolean;
};

export type ImapHealth = {
  connected: boolean;
  status: "connected" | "connecting" | "disconnected";
  send_enabled?: boolean;
  default_account?: string;
  accounts?: AccountHealth[];
};

export type AccountInfo = {
  name: string;
  provider: "icloud" | "imap";
  user: string;
  imap_host: string;
  send_enabled: boolean;
  default: boolean;
};

export type SendOpts = {
  account?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
};

export type RuleMatch = {
  unseen?: boolean;
  from?: string;
  subject?: string;
  q?: string;
};

export type RuleActions = {
  move?: string;
  add_flags?: string[];
  remove_flags?: string[];
};

export type RuleDef = {
  name: string;
  enabled: boolean;
  account?: string;
  folder: string;
  limit: number;
  match: RuleMatch;
  actions: RuleActions;
};

export type RuleHit = {
  rule: string;
  account: string;
  uid: number;
  folder: string;
  from: string | null;
  subject: string | null;
  actions: RuleActions;
  error?: string;
};

export type RuleApplyResult = {
  dry_run: boolean;
  hits: RuleHit[];
  scanned: number;
};

export type FolderSpec = {
  path: string;
  purpose: string;
};

export type FolderProfile = {
  name: string;
  protect: string[];
  folders: FolderSpec[];
};

export type FolderApplyItem = {
  path: string;
  action: "create" | "exists" | "skipped_protected";
  created?: boolean;
};

export type FolderApplyResult = {
  dry_run: boolean;
  account: string;
  items: FolderApplyItem[];
};

export interface MailBackend {
  start(): void;
  stop(): Promise<void>;
  health(): ImapHealth | Promise<ImapHealth>;
  listAccounts(): AccountInfo[] | Promise<AccountInfo[]>;
  listFolders(account?: string): Promise<FolderInfo[]>;
  createFolder(name: string, account?: string): Promise<{ path: string; created: boolean }>;
  listMessages(opts: ListMessagesOpts): Promise<MessageHeader[]>;
  getMessage(uid: number, folder: string, account?: string): Promise<MessageBody | null>;
  search(opts: SearchOpts): Promise<MessageHeader[]>;
  move(
    uid: number,
    from: string,
    to: string,
    account?: string,
  ): Promise<{ uid: number; from: string; to: string; account: string }>;
  setFlags(
    uid: number,
    update: FlagUpdate,
  ): Promise<{ uid: number; folder: string; flags: MessageFlags; account: string }>;
  sendMail(opts: SendOpts): Promise<{ messageId: string; account: string }>;
  getFolderProfile(): Promise<FolderProfile | null>;
  saveFolderProfile(profile: FolderProfile): Promise<FolderProfile>;
  applyFolderProfile(opts: {
    dryRun: boolean;
    account?: string;
    profile?: FolderProfile;
  }): Promise<FolderApplyResult>;
  listRules(): Promise<RuleDef[]>;
  applyRules(opts: { dryRun: boolean; account?: string }): Promise<RuleApplyResult>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
