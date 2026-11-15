import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInspection } from "./engine.js";
import {
  renderHtmlReport,
  contentSecurityPolicy,
  escapeJsonForHtmlScript
} from "./reportTemplate.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "xss-breakout.js"
);
const PAYLOAD = "</script><script>alert(1)</script>";
const NONCE = "0123456789abcdef0123456789abcdef";

test("scan fixture is escaped inside the report script and cannot execute", () => {
  const content = fs.readFileSync(fixturePath, "utf8");
  assert.equal(content.includes(PAYLOAD), true);
  assert.equal(content.includes("\u2028"), true);

  const report = runInspection([{ path: "xss-breakout.js", content }], "fixture", "xss");
  const html = renderHtmlReport(report, NONCE);

  assert.equal(html.includes(PAYLOAD), false);
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e/);
  assert.match(html, /\\u2028/);
  assert.match(html, /\\u0026/);
  assert.equal(html.toLowerCase().split("</script>").length - 1, 2);
  assert.match(html, new RegExp(`<script nonce="${NONCE}">`));
  assert.doesNotMatch(html, /<script(?![^>]*type="application\/json")(?![^>]*nonce=)[^>]*>/i);

  const dataMatch = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  assert.equal(dataMatch[1].includes("<"), false);
  assert.equal(dataMatch[1].includes(">"), false);
  assert.equal(dataMatch[1].includes("&"), false);
  const data = JSON.parse(dataMatch[1]);
  const evidence = data.files.flatMap((file) => file.issues.map((issue) => issue.evidence)).join("\n");
  assert.equal(evidence.includes(PAYLOAD), true);
  assert.equal(evidence.includes("\u2028"), true);

  const scriptMatch = html.match(new RegExp(`<script nonce="${NONCE}">([\\s\\S]*)</script>\\s*</body>`));
  assert.ok(scriptMatch);
  new Function(scriptMatch[1]);

  const policy = contentSecurityPolicy(NONCE);
  const scriptSrc = policy.split(";").find((part) => part.trim().startsWith("script-src"));
  assert.equal(scriptSrc.includes(`'nonce-${NONCE}'`), true);
  assert.equal(scriptSrc.includes("unsafe-inline"), false);
  assert.equal(html.includes("sky_bg"), false);
  assert.equal(html.includes("night_sky"), false);
});

test("json script escape covers angle brackets, ampersands, and line separators", () => {
  const encoded = escapeJsonForHtmlScript({ note: "a<b>c&d\u2028e\u2029f" });
  assert.equal(encoded.includes("<"), false);
  assert.equal(encoded.includes(">"), false);
  assert.equal(encoded.includes("&"), false);
  assert.equal(encoded.includes("\u2028"), false);
  assert.equal(encoded.includes("\u2029"), false);
  assert.equal(JSON.parse(encoded).note, "a<b>c&d\u2028e\u2029f");
});
