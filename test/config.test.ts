import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { interpolate, loadConfig } from "../src/config.js";
import { ICLOUD_PRESET } from "../src/providers.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "imaplane-"));
}

const TOKEN = "test-token-0123456789ab";

describe("icloud preset + generic imap config", () => {
  it("builds an icloud account from env (legacy .env)", () => {
    const root = tmpDir();
    const cfg = loadConfig({
      rootDir: root,
      loadDotenv: false,
      env: {
        BRIDGE_TOKEN: TOKEN,
        ICLOUD_USER: "you@icloud.com",
        ICLOUD_APP_PASSWORD: "aaaa-bbbb-cccc-dddd",
      },
    });
    assert.equal(cfg.defaultAccount, "icloud");
    assert.equal(cfg.accounts.length, 1);
    assert.equal(cfg.accounts[0]?.provider, "icloud");
    assert.equal(cfg.accounts[0]?.imap.host, ICLOUD_PRESET.imap.host);
    assert.equal(cfg.accounts[0]?.imap.port, 993);
    assert.equal(cfg.accounts[0]?.imap.secure, true);
    assert.equal(cfg.sendEnabled, false);
    assert.equal(cfg.sweeps.enabled, false);
  });

  it("loads generic imap from yaml with env interpolation", () => {
    const root = tmpDir();
    fs.writeFileSync(
      path.join(root, "imaplane.yaml"),
      `
default_account: work
send:
  enabled: false
accounts:
  work:
    provider: imap
    user: \${WORK_USER}
    password: \${WORK_PASSWORD}
    imap:
      host: mail.example.com
      port: 993
      tls: true
    smtp:
      host: mail.example.com
      port: 587
      tls: false
`,
      "utf8",
    );
    const cfg = loadConfig({
      rootDir: root,
      loadDotenv: false,
      env: {
        BRIDGE_TOKEN: TOKEN,
        WORK_USER: "me@example.com",
        WORK_PASSWORD: "secret-password",
      },
    });
    assert.equal(cfg.accounts[0]?.name, "work");
    assert.equal(cfg.accounts[0]?.provider, "imap");
    assert.equal(cfg.accounts[0]?.user, "me@example.com");
    assert.equal(cfg.accounts[0]?.imap.host, "mail.example.com");
    assert.equal(cfg.accounts[0]?.smtp.port, 587);
    assert.equal(cfg.accounts[0]?.smtp.secure, false);
  });

  it("interpolates ${ENV} placeholders", () => {
    assert.equal(interpolate("hi ${FOO}", { FOO: "there" }), "hi there");
  });

  it("rejects short tokens", () => {
    const root = tmpDir();
    assert.throws(
      () =>
        loadConfig({
          rootDir: root,
          loadDotenv: false,
          env: { BRIDGE_TOKEN: "short", ICLOUD_USER: "a@b.com", ICLOUD_APP_PASSWORD: "x" },
        }),
      /at least 16/,
    );
  });
});
