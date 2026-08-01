import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const netlifyConfig = fs.readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
const reportOnlyPolicy = netlifyConfig.match(/Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/)?.[1];

function headersFor(path) {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = netlifyConfig.match(new RegExp(`\\[\\[headers\\]\\]\\s*for\\s*=\\s*"${escapedPath}"([\\s\\S]*?)(?=\\n\\[\\[headers\\]\\]|$)`))?.[1];
  return Object.fromEntries([...block?.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]+)"$/gm) || []].map(([, name, value]) => [name, value]));
}

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

test("static authenticated SPA headers restrict browser capabilities and cache by resource type", () => {
  const defaultHeaders = headersFor("/*");
  const entryHeaders = headersFor("/");
  const indexHeaders = headersFor("/index.html");
  const assetHeaders = headersFor("/assets/*");

  assert.deepEqual(
    {
      "Permissions-Policy": defaultHeaders["Permissions-Policy"],
      "Referrer-Policy": defaultHeaders["Referrer-Policy"],
      "X-Content-Type-Options": defaultHeaders["X-Content-Type-Options"],
      "X-Frame-Options": defaultHeaders["X-Frame-Options"],
    },
    {
      "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  );

  assert.equal(entryHeaders["Cache-Control"], "no-cache, no-store, must-revalidate");
  assert.equal(indexHeaders["Cache-Control"], "no-cache, no-store, must-revalidate");
  assert.equal(assetHeaders["Cache-Control"], "public, max-age=31536000, immutable");
});
