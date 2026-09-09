import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import type { MessageBody, MessageHeader } from "../src/types.js";
import { MockBackend, testConfig, token } from "./helpers.js";

describe("http api", () => {
  const backend = new MockBackend();
  const app = createApp(backend, testConfig());
  let base = "";
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("serves health without a token", async () => {
    const res = await fetch(`${base}/v1/health`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; service: string; imap: { connected: boolean } };
    assert.equal(json.ok, true);
    assert.equal(json.service, "imaplane");
    assert.equal(json.imap.connected, true);
  });

  it("rejects missing bearer token", async () => {
    const res = await fetch(`${base}/v1/folders`);
    assert.equal(res.status, 401);
  });

  it("lists accounts", async () => {
    const res = await fetch(`${base}/v1/accounts`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { default: string; accounts: { name: string }[] };
    assert.equal(json.default, "icloud");
    assert.equal(json.accounts[0]?.name, "icloud");
  });

  it("lists inbox headers with a token", async () => {
    const res = await fetch(`${base}/v1/messages?folder=INBOX&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { messages: MessageHeader[] };
    assert.equal(json.messages[0]?.uid, 42);
    assert.equal(json.messages[0]?.unseen, true);
  });

  it("reads one message", async () => {
    const res = await fetch(`${base}/v1/messages/42?folder=INBOX`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { message: MessageBody };
    assert.equal(json.message.text, "Hello");
  });

  it("returns 404 for missing uid", async () => {
    const res = await fetch(`${base}/v1/messages/99?folder=INBOX`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
  });

  it("creates a folder, moves, and sets flags", async () => {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const created = await fetch(`${base}/v1/folders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Triage/Action" }),
    });
    assert.equal(created.status, 201);

    const moved = await fetch(`${base}/v1/messages/42/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: "INBOX", to: "Triage/Action" }),
    });
    assert.equal(moved.status, 200);

    const flagged = await fetch(`${base}/v1/messages/42/flags`, {
      method: "POST",
      headers,
      body: JSON.stringify({ folder: "INBOX", add: ["\\Seen"], remove: [] }),
    });
    assert.equal(flagged.status, 200);
    assert.deepEqual(backend.moved, [{ uid: 42, from: "INBOX", to: "Triage/Action", account: "icloud" }]);
  });

  it("does not register send when disabled", async () => {
    const res = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "a@b.com", subject: "x", text: "hi" }),
    });
    assert.equal(res.status, 404);
  });
});

describe("http api send opt-in", () => {
  const backend = new MockBackend();
  backend.sendEnabled = true;
  const app = createApp(backend, testConfig({ sendEnabled: true }));
  let base = "";
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("sends when enabled", async () => {
    const res = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "ada@example.com", subject: "Hi", text: "Hello" }),
    });
    assert.equal(res.status, 202);
    assert.equal(backend.sent.length, 1);
  });
});
