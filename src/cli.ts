#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runInit } from "./init.js";
import { ImaplaneService } from "./service.js";
import { TITLE, VERSION } from "./version.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }
  if (cmd === "version" || cmd === "-v" || cmd === "--version") {
    console.log(`${TITLE} ${VERSION}`);
    return;
  }
  if (cmd === "init") {
    await runInit(rootDir);
    return;
  }
  if (cmd === "start") {
    const { startServer } = await import("./server.js");
    await startServer();
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd === "rules") {
    const sub = argv[1] ?? "dry-run";
    const config = loadConfig({ rootDir });
    const service = new ImaplaneService(config);
    service.start();
    try {
      const result = await service.applyRules({ dryRun: sub !== "apply" });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await service.stop();
    }
    return;
  }
  if (cmd === "folders") {
    const sub = argv[1] ?? "apply";
    const dry = argv.includes("--dry-run") || sub === "dry-run";
    const config = loadConfig({ rootDir });
    const service = new ImaplaneService(config);
    service.start();
    try {
      const result = await service.applyFolderProfile({ dryRun: dry });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await service.stop();
    }
    return;
  }

  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`${TITLE} ${VERSION} — local IMAP plane for agents and apps

Usage:
  imaplane init              First-run wizard (needs a TTY; mints BRIDGE_TOKEN)
  imaplane start             HTTP API on loopback (owns IMAP)
  imaplane mcp               stdio MCP client of the HTTP API
  imaplane rules dry-run     Preview file-based rules
  imaplane rules apply       Apply rules
  imaplane folders apply     Create missing folders from the saved profile
  imaplane folders dry-run   Preview folder creates
  imaplane version

Docs: README.md  OpenAPI: openapi.yaml  Agent playbook: BOT.md
`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
