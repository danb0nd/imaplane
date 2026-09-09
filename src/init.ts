import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { stringify as stringifyYaml } from "yaml";

export async function runInit(rootDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "imaplane init needs a terminal. For a headless setup: copy .env.example → .env, generate BRIDGE_TOKEN with `openssl rand -hex 32` (must be ≥16 chars), and copy imaplane.yaml.example if you need yaml.",
    );
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log("Imaplane — local IMAP plane for agents\n");

    const token =
      (await ask(rl, "BRIDGE_TOKEN (blank = generate)", "")) || randomBytes(32).toString("hex");

    const accounts: Array<Record<string, unknown>> = [];
    const envLines: string[] = [
      `# Imaplane secrets — never commit this file`,
      `BRIDGE_TOKEN=${token}`,
      `HOST=127.0.0.1`,
      `PORT=8787`,
      "",
    ];

    let addMore = true;
    while (addMore) {
      const kind = (await ask(rl, "Add account: [1] iCloud  [2] generic IMAP  [3] done", "1")).trim();
      if (kind === "3" || kind.toLowerCase() === "done") {
        addMore = false;
        break;
      }
      if (kind === "2") {
        const name = sanitizeName((await ask(rl, "Account name", "mail")) || "mail");
        const user = await ask(rl, "IMAP username (email)", "");
        const password = await ask(rl, "IMAP password (will echo)", "");
        const host = await ask(rl, "IMAP host", "imap.example.com");
        const port = Number((await ask(rl, "IMAP port", "993")) || "993");
        const tls = (await ask(rl, "IMAP TLS? [Y/n]", "Y")).toLowerCase() !== "n";
        const smtpHost = await ask(rl, "SMTP host (blank = same as IMAP)", "") || host;
        const smtpPort = Number((await ask(rl, "SMTP port", "587")) || "587");
        const userEnv = envKey(name, "USER");
        const passEnv = envKey(name, "PASSWORD");
        envLines.push(`${userEnv}=${user}`, `${passEnv}=${password}`, "");
        accounts.push({
          [name]: {
            provider: "imap",
            user: `\${${userEnv}}`,
            password: `\${${passEnv}}`,
            imap: { host, port, tls },
            smtp: { host: smtpHost, port: smtpPort, tls: smtpPort === 465 },
          },
        });
      } else {
        const name = "icloud";
        const user = await ask(rl, "Apple ID email (full address)", "");
        console.log(
          "Create an app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords.",
        );
        const password = await ask(rl, "App-specific password (will echo)", "");
        envLines.push(`ICLOUD_USER=${user}`, `ICLOUD_APP_PASSWORD=${password}`, "");
        accounts.push({
          [name]: {
            provider: "icloud",
            user: "${ICLOUD_USER}",
            password: "${ICLOUD_APP_PASSWORD}",
          },
        });
      }
      addMore = (await ask(rl, "Add another account? [y/N]", "N")).toLowerCase() === "y";
    }

    if (accounts.length === 0) {
      console.error("No accounts added. Nothing written.");
      return;
    }

    const send = (await ask(rl, "Enable SMTP sending? [y/N]", "N")).toLowerCase() === "y";
    const sweeps = (await ask(rl, "Enable scheduled rule sweeps? [y/N]", "N")).toLowerCase() === "y";
    const interval = sweeps ? (await ask(rl, "Sweep interval", "15m")) || "15m" : "15m";

    const accountMap: Record<string, unknown> = {};
    for (const item of accounts) Object.assign(accountMap, item);
    const defaultAccount = Object.keys(accountMap)[0]!;

    const yaml = {
      host: "127.0.0.1",
      port: 8787,
      default_account: defaultAccount,
      send: { enabled: send },
      sweeps: { enabled: sweeps, interval },
      accounts: accountMap,
    };

    const envPath = path.join(rootDir, ".env");
    const yamlPathOut = path.join(rootDir, "imaplane.yaml");
    if (fs.existsSync(envPath)) {
      const overwrite = (await ask(rl, `.env exists. Overwrite? [y/N]`, "N")).toLowerCase() === "y";
      if (!overwrite) {
        console.log("Left existing .env in place. Write imaplane.yaml only if missing.");
      } else {
        writeSecret(envPath, envLines.join("\n") + "\n");
      }
    } else {
      writeSecret(envPath, envLines.join("\n") + "\n");
    }
    if (fs.existsSync(yamlPathOut)) {
      const overwrite = (await ask(rl, `imaplane.yaml exists. Overwrite? [y/N]`, "N")).toLowerCase() === "y";
      if (overwrite) fs.writeFileSync(yamlPathOut, stringifyYaml(yaml), "utf8");
    } else {
      fs.writeFileSync(yamlPathOut, stringifyYaml(yaml), "utf8");
    }

    const mcpPath = path.join(rootDir, "dist", "mcp.js");
    console.log(`
Wrote config. Secrets are in .env (mode 600).

Start the HTTP plane (IMAP lives here):
  npm run build
  npm start
  # or: npx imaplane start

Health:
  curl -sS http://127.0.0.1:8787/v1/health

MCP (Grok / any stdio host) — talks HTTP only, never IMAP:
  grok mcp add imaplane -- node ${mcpPath}

Generic MCP:
  command = node
  args = ["${mcpPath}"]
  env BRIDGE_TOKEN from .env

Sending is ${send ? "ENABLED" : "off"}. Sweeps are ${sweeps ? "ENABLED (" + interval + ")" : "off"}.
`);
  } finally {
    rl.close();
  }
}

function ask(rl: readline.Interface, q: string, def: string): Promise<string> {
  const hint = def ? ` (${def})` : "";
  return rl.question(`${q}${hint}: `).then((v) => (v.trim() === "" ? def : v.trim()));
}

function sanitizeName(name: string): string {
  const n = name.replace(/[^a-zA-Z0-9_-]/g, "") || "mail";
  return /^[a-zA-Z]/.test(n) ? n : `a${n}`;
}

function envKey(account: string, suffix: string): string {
  return `IMAPLANE_${account.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
}

function writeSecret(file: string, body: string): void {
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
}
