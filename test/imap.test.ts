import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { ImapBackend } from "../src/imap.js";
import { ImaplaneService } from "../src/service.js";
import { ICLOUD_PRESET } from "../src/providers.js";
import { testConfig } from "./helpers.js";

const BAD_IMAP = {
  name: "icloud",
  host: "127.0.0.1",
  port: 1,
  secure: true,
  user: "nobody@icloud.com",
  password: "wrong-password-not-real",
};

async function waitFor<T>(fn: () => T | Promise<T | undefined> | undefined, timeoutMs = 8_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for IMAP status");
}

describe("imap connect failure does not kill the process", () => {
  const backends: ImapBackend[] = [];
  const rejections: unknown[] = [];
  const onUnhandled = (err: unknown) => {
    rejections.push(err);
  };
  process.on("unhandledRejection", onUnhandled);

  after(async () => {
    process.off("unhandledRejection", onUnhandled);
    await Promise.all(backends.map((b) => b.stop()));
  });

  it("start() swallows connect failure and health reports IMAP down", async () => {
    const backend = new ImapBackend(BAD_IMAP);
    backends.push(backend);
    backend.start();

    const health = await waitFor(() => {
      const h = backend.health();
      if (h.status === "disconnected" && h.error) return h;
      return undefined;
    });

    assert.equal(health.connected, false);
    assert.equal(health.status, "disconnected");
    assert.match(health.error ?? "", /imap (connect|authentication) failed/i);
    assert.equal(rejections.length, 0);
  });
});

describe("http plane stays up when IMAP is unreachable", () => {
  it("GET /v1/health returns 200 with imap.connected false", async () => {
    const config = testConfig({
      accounts: [
        {
          name: "icloud",
          provider: "icloud",
          user: "nobody@icloud.com",
          password: "wrong-password-not-real",
          imap: { host: "127.0.0.1", port: 1, secure: true },
          smtp: { ...ICLOUD_PRESET.smtp },
          sendEnabled: false,
        },
      ],
    });
    const service = new ImaplaneService(config);
    const app = createApp(service, config);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${addr.port}`;

    const rejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    service.start();

    try {
      const json = await waitFor(async () => {
        const res = await fetch(`${base}/v1/health`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          imap: { connected: boolean; status: string; error?: string };
        };
        if (body.imap.status === "disconnected" && body.imap.error) return body;
        return undefined;
      });

      assert.equal(json.ok, true);
      assert.equal(json.imap.connected, false);
      assert.match(json.imap.error ?? "", /imap (connect|authentication) failed/i);
      assert.equal(rejections.length, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await service.stop();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
