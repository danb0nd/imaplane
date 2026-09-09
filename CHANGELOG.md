# Changelog

## 0.2.0 — 2026-09-09

- Rename to **Imaplane** (IMAP plane / “I’m a plane”). MIT license.
- Multi-account: `provider: icloud` (Apple Mail preset) and `provider: imap` (generic host/port/TLS).
- File-based rules with dry-run + apply (API, MCP, CLI).
- Optional scheduled sweeps (interval or cron). Default off.
- `imaplane init` wizard: token, iCloud and/or IMAP accounts, safe config write.
- Optional SMTP send, global or per-account. Default off; MCP omits `mail_send` when off.
- Folder profiles: interview → propose → confirm → create. Protect personal folders.
- MCP + OpenAPI kept in sync. Stable `mail_*` tool names; optional `account` argument.
- Tests mock IMAP; CI on Node 20 without real credentials.

## 0.1.0

- bot-imap-bridge: local HTTP + MCP iCloud IMAP organiser (no send).
