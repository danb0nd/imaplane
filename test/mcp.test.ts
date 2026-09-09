import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { HttpMailBackend } from "../src/bridgeClient.js";
import { handleMcpMessage } from "../src/mcpProtocol.js";
import { TOOL_NAMES } from "../src/mcpTools.js";
import type { MailBackend, MessageBody } from "../src/types.js";
import { MockBackend, body, sample, testConfig, token } from "./helpers.js";

const invoiceBody: MessageBody = {
  ...body,
  subject: "Invoice 12",
  text: "Please pay invoice 12",
  html: `<p onclick="alert(1)">Please pay invoice 12</p>`,
  attachments: [
    { filename: "inv.pdf", contentType: "application/pdf", size: 10, contentId: null, contentDisposition: "attachment" },
  ],
};

function invoiceBackend(): MockBackend {
  const backend = new MockBackend();
  backend.messages = [{ ...sample, subject: "Invoice 12" }];
  backend.bodies.set(42, invoiceBody);
  return backend;
}

async function rpc(backend: MailBackend, method: string, params?: unknown, id: number = 1) {
  const raw = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return handleMcpMessage(raw, backend);
}

describe("mcp protocol", () => {
  const backend = invoiceBackend();

  it("initializes and lists only mail tools (no send)", async () => {
    const init = await rpc(backend, "initialize", { protocolVersion: "2025-03-26" });
    assert.equal(init?.result && (init.result as { serverInfo: { name: string } }).serverInfo.name, "imaplane");
    const listed = await rpc(backend, "tools/list");
    const tools = (listed?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.deepEqual(tools, TOOL_NAMES);
    assert.ok(!tools.some((name) => /send|reply|smtp/i.test(name)));
    const instructions = (init?.result as { instructions?: string }).instructions ?? "";
    assert.match(instructions, /Never send mail/i);
    assert.match(instructions, /folder setup/i);
  });

  it("triages: list, read, move, flag via tools/call", async () => {
    const listed = await rpc(backend, "tools/call", { name: "mail_list", arguments: { folder: "INBOX", unseen: true } });
    const listText = (listed?.result as { content: { text: string }[] }).content[0]?.text ?? "";
    assert.match(listText, /Invoice 12/);

    const read = await rpc(backend, "tools/call", { name: "mail_read", arguments: { uid: 42, folder: "INBOX" } });
    const readText = (read?.result as { content: { text: string }[] }).content[0]?.text ?? "";
    assert.match(readText, /Please pay invoice 12/);
    assert.doesNotMatch(readText, /"html"/);

    const moved = await rpc(backend, "tools/call", {
      name: "mail_move",
      arguments: { uid: 42, from: "INBOX", to: "Triage/Action" },
    });
    assert.match((moved?.result as { content: { text: string }[] }).content[0]?.text ?? "", /Triage\/Action/);

    const flagged = await rpc(backend, "tools/call", {
      name: "mail_flags",
      arguments: { uid: 42, folder: "INBOX", add: ["\\Seen"] },
    });
    assert.match((flagged?.result as { content: { text: string }[] }).content[0]?.text ?? "", /Seen/);
    assert.deepEqual(backend.moved, [{ uid: 42, from: "INBOX", to: "Triage/Action", account: "icloud" }]);
  });

  it("returns isError for unknown tool rather than a send path", async () => {
    const res = await rpc(backend, "tools/call", { name: "mail_send", arguments: {} });
    assert.equal((res?.result as { isError: boolean }).isError, true);
  });

  it("ignores notifications", async () => {
    const res = await handleMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      backend,
    );
    assert.equal(res, null);
  });
});

describe("mcp send opt-in", () => {
  it("lists mail_send only when health.send_enabled", async () => {
    const backend = invoiceBackend();
    backend.sendEnabled = true;
    const listed = await rpc(backend, "tools/list");
    const tools = (listed?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.ok(tools.includes("mail_send"));
  });
});

describe("mcp over mock HTTP (no IMAP)", () => {
  const mock = invoiceBackend();
  const app = createApp(mock, testConfig());
  let server: ReturnType<typeof app.listen>;
  let backend: HttpMailBackend;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address() as AddressInfo;
    backend = new HttpMailBackend({ baseUrl: `http://127.0.0.1:${addr.port}/v1`, token });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("Grok tool path: health → list → read → move", async () => {
    const health = await rpc(backend, "tools/call", { name: "mail_health", arguments: {} });
    assert.match((health?.result as { content: { text: string }[] }).content[0]?.text ?? "", /"connected": true/);

    const list = await rpc(backend, "tools/call", { name: "mail_list", arguments: { unseen: true } });
    assert.match((list?.result as { content: { text: string }[] }).content[0]?.text ?? "", /"uid": 42/);

    const read = await rpc(backend, "tools/call", { name: "mail_read", arguments: { uid: 42 } });
    assert.match((read?.result as { content: { text: string }[] }).content[0]?.text ?? "", /Please pay invoice 12/);

    const move = await rpc(backend, "tools/call", {
      name: "mail_move",
      arguments: { uid: 42, from: "INBOX", to: "Triage/Action" },
    });
    assert.equal((move?.result as { isError?: boolean }).isError, false);
    assert.deepEqual(mock.moved, [{ uid: 42, from: "INBOX", to: "Triage/Action", account: "icloud" }]);
  });
});
