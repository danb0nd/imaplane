import nodemailer from "nodemailer";
import type { AccountConfig } from "./config.js";
import { HttpError, type SendOpts } from "./types.js";

export async function sendViaSmtp(
  account: AccountConfig,
  opts: SendOpts,
): Promise<{ messageId: string; account: string }> {
  if (!account.sendEnabled) {
    throw new HttpError(403, `sending is disabled for account ${account.name}`);
  }
  const to = asList(opts.to);
  if (!to.length) throw new HttpError(400, "to is required");
  if (!opts.subject?.trim()) throw new HttpError(400, "subject is required");
  if (!opts.text && !opts.html) throw new HttpError(400, "text or html is required");

  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    requireTLS: account.smtp.requireTLS,
    auth: { user: account.user, pass: account.password },
  });

  try {
    const info = await transport.sendMail({
      from: account.user,
      to,
      cc: asList(opts.cc),
      bcc: asList(opts.bcc),
      subject: opts.subject.trim(),
      text: opts.text,
      html: opts.html,
    });
    return { messageId: info.messageId || "", account: account.name };
  } catch (err) {
    throw new HttpError(502, `smtp send failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    transport.close();
  }
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((s) => s.trim()).filter(Boolean);
}
