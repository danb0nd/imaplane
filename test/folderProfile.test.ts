import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFolderProfile, EXAMPLE_BOTMAIL_PROFILE, isProtected } from "../src/folderProfile.js";
import { MockBackend } from "./helpers.js";

describe("folder profile", () => {
  it("protects Important and similar", () => {
    assert.equal(isProtected("Important", EXAMPLE_BOTMAIL_PROFILE.protect), true);
    assert.equal(isProtected("BotMail/Action", EXAMPLE_BOTMAIL_PROFILE.protect), false);
  });

  it("dry-run proposes creates and skips existing/protected", async () => {
    const backend = new MockBackend();
    backend.folders = ["INBOX", "Important", "BotMail/Action"];
    const result = await applyFolderProfile(
      backend,
      {
        name: "t",
        protect: ["Important"],
        folders: [
          { path: "Important", purpose: "nope" },
          { path: "BotMail/Action", purpose: "exists" },
          { path: "BotMail/Park", purpose: "keep" },
        ],
      },
      { dryRun: true, account: "icloud" },
    );
    assert.equal(result.items.find((i) => i.path === "Important")?.action, "skipped_protected");
    assert.equal(result.items.find((i) => i.path === "BotMail/Action")?.action, "exists");
    assert.equal(result.items.find((i) => i.path === "BotMail/Park")?.action, "create");
    assert.equal(backend.created.length, 0);
  });

  it("apply creates missing paths including parents", async () => {
    const backend = new MockBackend();
    backend.folders = ["INBOX"];
    const result = await applyFolderProfile(
      backend,
      { name: "t", protect: ["Important"], folders: [{ path: "BotMail/Park", purpose: "keep" }] },
      { dryRun: false },
    );
    assert.ok(backend.created.includes("BotMail"));
    assert.ok(backend.created.includes("BotMail/Park"));
    assert.equal(result.items[0]?.action, "create");
  });
});
