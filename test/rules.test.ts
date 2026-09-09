import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRules, headerMatches } from "../src/rules.js";
import type { MessageHeader, RuleDef } from "../src/types.js";
import { MockBackend, sample } from "./helpers.js";

const stripe: MessageHeader = {
  ...sample,
  uid: 7,
  from: [{ name: "Stripe", address: "receipts@stripe.com" }],
  subject: "Your receipt from Stripe",
};

describe("rules", () => {
  it("matches from domain and subject", () => {
    assert.equal(headerMatches(stripe, { from: "stripe.com", subject: "receipt" }), true);
    assert.equal(headerMatches(stripe, { from: "@stripe.com" }), true);
    assert.equal(headerMatches(stripe, { from: "ada@example.com" }), false);
    assert.equal(headerMatches({ ...stripe, unseen: false }, { unseen: true }), false);
  });

  it("dry-run reports hits without moving", async () => {
    const backend = new MockBackend();
    backend.messages = [stripe];
    const rules: RuleDef[] = [
      {
        name: "stripe-receipts",
        enabled: true,
        folder: "INBOX",
        limit: 50,
        match: { from: "stripe.com", subject: "receipt" },
        actions: { move: "BotMail/Receipts", add_flags: ["\\Seen"] },
      },
    ];
    const result = await applyRules(backend, rules, { dryRun: true, defaultAccount: "icloud" });
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0]?.rule, "stripe-receipts");
    assert.equal(backend.moved.length, 0);
  });

  it("apply moves and flags", async () => {
    const backend = new MockBackend();
    backend.messages = [stripe];
    const rules: RuleDef[] = [
      {
        name: "stripe-receipts",
        enabled: true,
        folder: "INBOX",
        limit: 50,
        match: { from: "stripe.com" },
        actions: { move: "BotMail/Receipts", add_flags: ["\\Seen"] },
      },
    ];
    const result = await applyRules(backend, rules, { dryRun: false, defaultAccount: "icloud" });
    assert.equal(result.dry_run, false);
    assert.equal(backend.moved[0] && (backend.moved[0] as { to: string }).to, "BotMail/Receipts");
    assert.equal(backend.flags.length, 1);
  });
});
