import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronMatches } from "../src/cron.js";
import { parseDuration } from "../src/duration.js";

describe("parseDuration", () => {
  it("parses s/m/h", () => {
    assert.equal(parseDuration("30s", 1), 30_000);
    assert.equal(parseDuration("15m", 1), 15 * 60_000);
    assert.equal(parseDuration("1h", 1), 3_600_000);
  });
});

describe("cronMatches", () => {
  it("matches a fixed minute", () => {
    const d = new Date("2026-01-02T03:15:00");
    assert.equal(cronMatches("15 * * * *", d), true);
    assert.equal(cronMatches("0 * * * *", d), false);
    assert.equal(cronMatches("*/15 * * * *", d), true);
  });
});
