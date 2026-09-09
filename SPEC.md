# Imaplane — spec

Local **IMAP plane** for agents and apps: HTTP API + MCP + OpenAPI. List, search, file, and (optionally) send mail. Secrets stay on the machine that runs the plane.

**Name:** Imaplane — IMAP plane, and “I’m a plane”.

## Goals

1. First-class **iCloud / Apple Mail** (preset hosts, app-specific password) and **generic IMAP/SMTP** (custom host/port/TLS). No OAuth required for v1.
2. Named **multi-account** pools. API/MCP take optional `account` (default supported).
3. File-based **rules** and optional **sweeps** (default off).
4. **Folder profiles** so agents interview, propose, confirm — they must not invent a tree.
5. **Send** only when explicitly enabled. MCP does not register `mail_send` otherwise.
6. Loopback by default. Started explicitly (`imaplane start` / `npm start`). launchd is optional, not default.

## Non-goals

- OAuth (see ROADMAP)
- Public bind / multi-tenant SaaS by default
- AppleScript / Mail.app automation
- launchd as default

## Auth

### iCloud IMAP

- Host: `imap.mail.me.com:993` TLS
- User: full Apple ID email
- Password: **app-specific password** from [appleid.apple.com](https://appleid.apple.com)
- SMTP (opt-in): `smtp.mail.me.com:587` STARTTLS

### Generic IMAP

- User-supplied host, port, TLS
- Same username/password for SMTP when send is enabled

### Plane

- `127.0.0.1:8787` default
- `Authorization: Bearer <BRIDGE_TOKEN>` except `/health`
- `.env` gitignored; `imaplane.yaml` uses `${ENV}` for secrets

## Process split

- HTTP process owns IMAP (one imapflow connection per account).
- MCP stdio process is an HTTP client. It never opens IMAP.

## Success criteria

- [x] `npm test` and `npm run build` without real mail credentials
- [x] Bot can list INBOX, read one mail, move it
- [x] README documents iCloud + generic IMAP, MCP, OpenAPI, security
- [x] Send path absent unless enabled
