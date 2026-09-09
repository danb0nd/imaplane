# Imaplane

Local HTTP + MCP plane so agents — and any HTTP client — can read and file mail over IMAP. Secrets stay in `.env` / env interpolation — never in git.

- Stack: Node 20+, TypeScript, Express, imapflow.
- IMAP lives only in `src/imap.ts` (one pool per account). HTTP process: `src/index.ts` / `src/server.ts`.
- MCP (`src/mcp.ts`) is a stdio JSON-RPC client of `http://127.0.0.1:8787/v1`. It must not open IMAP.
- SMTP send is opt-in (`send.enabled`). Default off; when off, do not register send MCP tools.
- Logs: subjects/from at info; never passwords, tokens, or full bodies.
- Bind loopback. Tests use a mock backend — do not connect to real mail from tests or from MCP.

Bot behaviour: [`BOT.md`](./BOT.md). If the user asks about folder setup, interview, propose, confirm, then create.
