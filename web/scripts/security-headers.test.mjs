import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const netlifyConfig = fs.readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
const reportOnlyPolicy = netlifyConfig.match(/Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/)?.[1];

test("report-only CSP constrains the authenticated SPA to its required production origins", () => {
  assert.ok(reportOnlyPolicy, "netlify.toml must define a report-only CSP");

  for (const directive of [
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self' https://beaming-bass-637.convex.cloud wss://beaming-bass-637.convex.cloud https://beaming-bass-637.convex.site",
  ]) {
    assert.match(reportOnlyPolicy, new RegExp(`(?:^|; )${directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:;|$)`));
  }

  assert.match(reportOnlyPolicy, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(reportOnlyPolicy, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(reportOnlyPolicy, /\*/);
  assert.doesNotMatch(reportOnlyPolicy, /'unsafe-inline'|'unsafe-eval'/);
});
