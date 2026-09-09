import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { HttpMailBackend, loadBridgeClientConfig } from "./bridgeClient.js";
import { handleMcpMessage } from "./mcpProtocol.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config();

const backend = new HttpMailBackend(loadBridgeClientConfig());

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  void handleMcpMessage(trimmed, backend)
    .then((response) => {
      if (!response) return;
      process.stdout.write(`${JSON.stringify(response)}\n`);
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    });
});
