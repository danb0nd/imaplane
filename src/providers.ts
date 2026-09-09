export type SocketMode = "tls" | "starttls" | "plain";

export type MailSockets = {
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean };
};

/** First-class iCloud / Apple Mail IMAP + SMTP (app-specific password, no OAuth). */
export const ICLOUD_PRESET: MailSockets = {
  imap: { host: "imap.mail.me.com", port: 993, secure: true },
  smtp: { host: "smtp.mail.me.com", port: 587, secure: false, requireTLS: true },
};

export function imapSockets(opts: {
  host: string;
  port?: number;
  tls?: boolean;
}): MailSockets["imap"] {
  const tls = opts.tls !== false;
  const port = opts.port ?? (tls ? 993 : 143);
  return { host: opts.host, port, secure: tls };
}

export function smtpSockets(opts: {
  host: string;
  port?: number;
  tls?: boolean;
}): MailSockets["smtp"] {
  const port = opts.port ?? 587;
  const implicitTls = opts.tls === true || port === 465;
  return {
    host: opts.host,
    port,
    secure: implicitTls,
    requireTLS: !implicitTls && port === 587,
  };
}
