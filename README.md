# Imaplane

<p align="center">
  <img src="assets/logo.png" alt="Imaplane — bot on a paper plane" width="220" />
</p>

A local IMAP control plane for **AI agents** and **your own programs** — anything you allow, not everything.

**Agents** use MCP. **Scripts, backends, CLIs, and apps** call the same local HTTP API (OpenAPI) to read, search, and move mail. First-class **iCloud / Apple Mail** and **generic IMAP**. Loopback by default. You start it on purpose.

IMAP plane · IMAP lane · I’m a plane.

**Site:** [https://imaplane.com](https://imaplane.com) (Cloudflare Pages; also [https://imaplane.pages.dev](https://imaplane.pages.dev)).

Authenticate with a bridge token. Mailbox passwords never leave this machine.

**Default off:** sending, scheduled sweeps, public bind, launchd.

## Quick start

Requires **Node 20+**. Some dependencies (notably `sanitize-html`) may print an `EBADENGINE` warning unless you are on Node 22.12+; install and runtime still work on Node 20.

```bash
npm install
npm run build              # required before `npx imaplane` (the bin is dist/cli.js)
```

Then configure. Interactive wizard (**needs a TTY**; it mints `BRIDGE_TOKEN`):

```bash
npx imaplane init          # token + iCloud and/or IMAP account
```

Or env-only / headless (`imaplane init` refuses without a terminal — no flags):

```bash
cp .env.example .env
openssl rand -hex 32       # paste into BRIDGE_TOKEN= in .env (≥16 chars; do not leave empty)
# set ICLOUD_USER + ICLOUD_APP_PASSWORD (app-specific password, not your Apple ID password)
# or copy imaplane.yaml.example → imaplane.yaml for named / generic IMAP accounts
```

```bash
npm start                  # HTTP plane owns IMAP
```

```bash
curl -sS http://127.0.0.1:8787/v1/health
```

`/v1/health` is process liveness: it stays up if IMAP is down (wrong password, network, etc.). `imap.connected` will be `false` and `imap.error` explains the last connect/auth failure. A valid mailbox and app-specific password are still required for a healthy IMAP connection.

Env-only iCloud (no yaml) still works: `.env` with `ICLOUD_USER`, `ICLOUD_APP_PASSWORD`, and a generated `BRIDGE_TOKEN`.

## MCP (Claude, Codex, Grok, Cursor, …)

Keep `npm start` running. MCP is a thin stdio wrapper: it only calls `http://127.0.0.1:8787/v1` with your bridge token. It never sees mailbox passwords.

**1. Build once** (if you haven’t):

```bash
npm run build
```

**2. Absolute path to the MCP entry** (copy yours):

```bash
# macOS / Linux
echo "$(pwd)/dist/mcp.js"
```

```powershell
# Windows (PowerShell)
(Resolve-Path .\dist\mcp.js).Path
# or from cmd: %CD%\dist\mcp.js
```

`node` must be on your `PATH` on Windows as well (same as macOS/Linux).

**3. Add a stdio MCP server** named `imaplane` in your client:

| Client | How |
|---|---|
| **Claude Desktop** | Edit `claude_desktop_config.json` → `mcpServers` (JSON below) |
| **Claude Code** | `claude mcp add imaplane -- node /ABS/PATH/TO/imaplane/dist/mcp.js` |
| **Codex** | Add the same stdio server in Codex MCP settings / config |
| **Grok** | `grok mcp add imaplane -- node /ABS/PATH/TO/imaplane/dist/mcp.js` or paste [`grok.mcp.toml.example`](./grok.mcp.toml.example) into `~/.grok/config.toml` |
| **Cursor** | Settings → MCP → add stdio server with the same `command` / `args` |
| **Other MCP hosts** | Same pattern: command `node`, args `["/ABS/PATH/TO/imaplane/dist/mcp.js"]` |

Generic JSON (Claude Desktop and most hosts):

```json
{
  "mcpServers": {
    "imaplane": {
      "command": "node",
      "args": ["/ABS/PATH/TO/imaplane/dist/mcp.js"]
    }
  }
}
```

On Windows, use a Windows-style absolute path in `args` (escaped backslashes in JSON), for example:

```json
"args": ["C:\\Users\\YOU\\Programming\\imaplane\\dist\\mcp.js"]
```

Forward slashes often work in JSON too: `C:/Users/YOU/imaplane/dist/mcp.js`.

The MCP process loads `BRIDGE_TOKEN` from this project’s `.env` (or set `BRIDGE_TOKEN` / optional `BRIDGE_URL` in the server `env` block).

**Tools:** `mail_health`, `mail_accounts`, `mail_folders`, `mail_create_folder`, `mail_list`, `mail_read`, `mail_search`, `mail_move`, `mail_flags`, `mail_folder_profile`, `mail_save_folder_profile`, `mail_apply_folder_profile`, `mail_rules_dry_run`, `mail_rules_apply`.  
`mail_send` appears **only** when sending is enabled.

Agent playbook: [`BOT.md`](./BOT.md) (folder setup = interview → propose → confirm → create).

## iCloud / Apple Mail

1. [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**.
2. Generate one labelled `imaplane`.
3. Full Apple ID email as user (`@icloud.com`, `@me.com`, or `@mac.com`).
4. App-specific password — not your Apple ID password.

Preset: `imap.mail.me.com:993` TLS, `smtp.mail.me.com:587` STARTTLS.

```yaml
# imaplane.yaml
accounts:
  icloud:
    provider: icloud
    user: ${ICLOUD_USER}
    password: ${ICLOUD_APP_PASSWORD}
```

## Generic IMAP

No OAuth. Host, port, TLS, username, password.

```yaml
accounts:
  work:
    provider: imap
    user: ${WORK_USER}
    password: ${WORK_PASSWORD}
    imap:
      host: mail.example.com
      port: 993
      tls: true
    smtp:
      host: mail.example.com
      port: 587
      tls: false        # 587 STARTTLS; tls: true for 465
```

`account=work` on API/MCP selects it. `default_account` is used when omitted.

## Config

| Piece | Role |
|---|---|
| `.env` | Secrets (`BRIDGE_TOKEN`, passwords). gitignored |
| `imaplane.yaml` | Accounts, send, sweeps, folder profiles, rules. gitignored; see `imaplane.yaml.example` |
| `folders.yaml` / `rules.yaml` | Optional overlays |

`imaplane init` writes `.env` (mode 600) and `imaplane.yaml`.

## HTTP API

Same surface MCP uses. Call it from curl, a backend, a CLI, or generate a client from OpenAPI.

Base: `http://127.0.0.1:8787/v1`  
Auth: `Authorization: Bearer $BRIDGE_TOKEN` except `/health`  
Optional query/body: `account`

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (process up even if IMAP is down; see `imap.connected` / `imap.error`) |
| GET | `/accounts` | Named accounts |
| GET | `/folders` | List mailboxes |
| POST | `/folders` | `{ "name": "BotMail/Action" }` |
| GET | `/folder-profile` | Saved folder tree + protect list |
| PUT | `/folder-profile` | Save profile after the user confirms |
| POST | `/folder-profile/apply` | `{ "dry_run": true }` then `false` |
| GET | `/messages?folder=INBOX&limit=50` | Headers, newest first |
| GET | `/messages/:uid?folder=INBOX` | Body (text + sanitized html; attachment metadata) |
| GET | `/search?folder=INBOX&q=...` | IMAP SEARCH |
| POST | `/messages/:uid/move` | `{ "from": "INBOX", "to": "BotMail/Action" }` |
| POST | `/messages/:uid/flags` | `{ "folder": "INBOX", "add": ["\\Seen"] }` |
| GET | `/rules` | Loaded rules |
| POST | `/rules/apply` | `{ "dry_run": true }` |
| POST | `/messages/send` | **Only if `send.enabled`** |

OpenAPI: [`openapi.yaml`](./openapi.yaml). Import it to generate a client in any language.

## Folder profiles

Agents must not invent a full tree. Saved profile + `protect` list (e.g. `Important`) are first-class.

```bash
imaplane folders dry-run
imaplane folders apply
```

Example: [`examples/folders.botmail.yaml`](./examples/folders.botmail.yaml).

## Rules and sweeps

File-based match → move/flags. Dry-run first.

```bash
imaplane rules dry-run
imaplane rules apply
```

Sweeps (`sweeps.enabled`) run those rules on `interval` (`15m`) or `cron`. **Default off.**

## Sending

Default off. Set `send.enabled: true` (and per-account `send: true` if you want a subset). Uses SMTP, not IMAP APPEND. When off, the send HTTP route and MCP tool are absent.

## Security

- App-specific or mailbox password; rotatable
- Bridge token on every non-health request (≥16 chars)
- One IMAP connection per account; ops serialised per account
- Logs subjects/from; never passwords, tokens, or full bodies
- Bind `127.0.0.1` unless you are reaching it over a mesh VPN (below). Do not port-forward on the router or use Tailscale Funnel.

## Remote access (Tailscale)

The plane is loopback-only on purpose. To use it from another machine (phone, laptop, a Grok host on the same tailnet), put a private overlay in front — **Tailscale**, Headscale, or WireGuard. Same idea for all of them: the IMAP passwords stay on the Mac; the remote side only gets `BRIDGE_TOKEN` + HTTP.

Do not publish Imaplane on the public internet.

### 1. Preferred — keep `127.0.0.1`, proxy with Serve

HTTP stays on loopback. Tailscale terminates TLS on your tailnet hostname.

```bash
# on the Mac that runs `npm start`
tailscale serve --bg 8787
# → https://<machine>.<tailnet>.ts.net/
```

From another device on the tailnet:

```bash
curl -sS -H "Authorization: Bearer $BRIDGE_TOKEN" \
  https://<machine>.<tailnet>.ts.net/v1/health
```

MCP on that remote device (stdio still local; it calls HTTP over the tailnet):

```bash
# .env next to imaplane, or the MCP process environment
BRIDGE_TOKEN=…                  # same token as the Mac
BRIDGE_URL=https://<machine>.<tailnet>.ts.net/v1
```

`tailscale funnel` would expose this to the whole internet — don’t.

### 2. SSH tunnel

No bind change. From the remote machine:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@<machine>
# then http://127.0.0.1:8787/v1 as if you were on the Mac
```

Works with `tailscale ssh` the same way.

### 3. Bind only the Tailscale interface

If a client cannot use Serve or SSH, bind the tailnet IP — not `0.0.0.0`, not your LAN.

```bash
tailscale ip -4          # e.g. 100.x.y.z
```

```bash
# .env on the Mac
HOST=100.x.y.z
PORT=8787
```

Or in `imaplane.yaml`: `host: 100.x.y.z`. Restart. Imaplane logs a warning when it is off loopback — keep `BRIDGE_TOKEN` long (`openssl rand -hex 32`). Restrict Tailscale ACLs so only your nodes can hit port 8787.

Remote MCP:

```bash
BRIDGE_URL=http://100.x.y.z:8787/v1
BRIDGE_TOKEN=…
```

Headscale / plain WireGuard: same pattern (Serve if you have it, otherwise bind the mesh IP or tunnel). Always HTTPS or a tunnel; never a public A record.

## CLI

```
imaplane init | start | mcp | rules dry-run|apply | folders apply|--dry-run | version
```

`npm start` is the same as `imaplane start`. launchd scripts exist under `scripts/` if you want login start — **not installed by default**.

## Landing page

Public site: [https://imaplane.com](https://imaplane.com) (Cloudflare Pages). Optional local marketing page lives in `landing-page/` (gitignored). Open `landing-page/index.html` on your machine if you have it.

## Help make it better

Issues and PRs welcome on [GitHub](https://github.com/danb0nd/imaplane/issues). Ideas especially welcome for folder profiles, rules, providers, and MCP docs.

## Develop

```bash
npm test          # mocked IMAP, no real credentials
npm run build
```

Node 20+ (some deps may warn for 22.12+; see Quick start). Spec: [`SPEC.md`](./SPEC.md). Roadmap: [`ROADMAP.md`](./ROADMAP.md). License: MIT.
