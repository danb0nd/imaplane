import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchQuery } from "../src/searchQuery.js";
import { normalizeFolder, parseLimit, parseUid } from "../src/folders.js";
import { HttpError } from "../src/types.js";

describe("buildSearchQuery", () => {
  it("ORs free-text across subject/from/body", () => {
    const q = buildSearchQuery({ folder: "INBOX", limit: 10, q: "invoice" });
    assert.deepEqual(q, { or: [{ subject: "invoice" }, { from: "invoice" }, { body: "invoice" }] });
  });

  it("treats q=unseen as unseen helper", () => {
    assert.deepEqual(buildSearchQuery({ folder: "INBOX", limit: 10, q: "unseen" }), { seen: false });
  });

  it("parses from: and subject: prefixes", () => {
    assert.deepEqual(buildSearchQuery({ folder: "INBOX", limit: 10, q: "from:ada@x.com" }), {
      from: "ada@x.com",
    });
    assert.deepEqual(buildSearchQuery({ folder: "INBOX", limit: 10, q: "subject:hello" }), {
      subject: "hello",
    });
  });

  it("ANDs unseen with other clauses", () => {
    const q = buildSearchQuery({ folder: "INBOX", limit: 10, q: "tax", unseen: true });
    assert.deepEqual(q, {
      seen: false,
      or: [{ subject: "tax" }, { from: "tax" }, { body: "tax" }],
    });
  });
});

describe("normalizeFolder", () => {
  it("maps INBOX case-insensitively", () => {
    assert.equal(normalizeFolder("inbox", "/"), "INBOX");
  });

  it("rewrites / to the server delimiter", () => {
    assert.equal(normalizeFolder("Triage/Action", "."), "Triage.Action");
  });

  it("keeps / when that is the delimiter", () => {
    assert.equal(normalizeFolder("Triage/Action", "/"), "Triage/Action");
  });
});

describe("parsers", () => {
  it("caps limit", () => {
    assert.equal(parseLimit("999", 50, 200), 200);
    assert.equal(parseLimit(undefined), 50);
  });

  it("rejects bad uids", () => {
    assert.throws(() => parseUid("nope"), HttpError);
    assert.equal(parseUid("12"), 12);
  });
});
