import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToPlain, sanitizeMessageHtml } from "../src/html.js";

describe("sanitizeMessageHtml", () => {
  it("strips scripts and event handlers", () => {
    const html = `<p onclick="alert(1)">Hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;
    const out = sanitizeMessageHtml(html);
    assert.ok(out);
    assert.doesNotMatch(out, /script/i);
    assert.doesNotMatch(out, /onclick/i);
    assert.doesNotMatch(out, /javascript:/i);
  });

  it("keeps safe links and images", () => {
    const html = `<p>See <a href="https://example.com">site</a></p><img src="cid:abc" alt="logo">`;
    const out = sanitizeMessageHtml(html);
    assert.ok(out?.includes("https://example.com"));
    assert.ok(out?.includes("cid:abc"));
  });

  it("returns null for empty input", () => {
    assert.equal(sanitizeMessageHtml(""), null);
    assert.equal(sanitizeMessageHtml(undefined), null);
  });
});

describe("htmlToPlain", () => {
  it("drops tags", () => {
    assert.equal(htmlToPlain("<p>Hello <b>world</b></p>"), "Hello world");
  });
});
