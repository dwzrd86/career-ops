import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { verifyLiveRelease } from "./release-smoke.mjs";
import { assertReleasePolicy, configuredSecurityPolicy } from "./security-policy.mjs";

const expectedConvexUrl = "https://beaming-bass-637.convex.cloud";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`https://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function headers(extra = {}) {
  return {
    "cache-control": "no-cache, no-store, must-revalidate",
    "content-security-policy": configuredSecurityPolicy(),
    "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra,
  };
}

test("release smoke verifies anonymous shell, enforced headers, and the production bundle endpoint", async () => {
  await withServer((request, response) => {
    if (request.url === "/assets/index.js") {
      response.writeHead(200, { "cache-control": "public, max-age=31536000, immutable", "content-type": "application/javascript" });
      response.end(`const convexUrl = "${expectedConvexUrl}";`);
      return;
    }
    response.writeHead(200, { "content-type": "text/html", ...headers() });
    response.end('<!doctype html><div id="root"></div><script src="/assets/index.js"></script>');
  }, async (site) => {
    await verifyLiveRelease({ site, expectedConvexUrl, fetchImpl: (url, options) => fetch(String(url).replace("https://", "http://"), options) });
  });
});

test("release smoke rejects a report-only-only CSP", async () => {
  await withServer((request, response) => {
    const reportOnlyHeaders = headers({ "content-security-policy-report-only": "default-src 'self'" });
    delete reportOnlyHeaders["content-security-policy"];
    response.writeHead(200, { "content-type": "text/html", ...reportOnlyHeaders });
    response.end('<!doctype html><div id="root"></div><script src="/assets/index.js"></script>');
  }, async (site) => {
    await assert.rejects(() => verifyLiveRelease({ site, expectedConvexUrl, fetchImpl: (url, options) => fetch(String(url).replace("https://", "http://"), options) }), /enforced Content-Security-Policy/);
  });
});


test("release policy accepts equivalent directive/source order and whitespace", () => {
  const policy = configuredSecurityPolicy().split(";").filter(value => value.trim())
    .reverse().map(value => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, ...sources.reverse()].join("  ");
    }).join(" ; ");
  assertReleasePolicy(policy, expectedConvexUrl, "/");
});

test("release policy rejects missing, widened, stale, and ambiguous policies", () => {
  const policy = configuredSecurityPolicy();
  for (const invalid of [
    "default-src 'self'",
    policy.replace("connect-src 'self'", "connect-src 'self' https://unapproved.example"),
    policy.replaceAll("beaming-bass-637", "stale-deployment"),
    policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    `${policy}; connect-src *`,
  ]) {
    assert.throws(() => assertReleasePolicy(invalid, expectedConvexUrl, "/"), /CSP/);
  }
  assert.throws(() => assertReleasePolicy(policy, "https://other-production.convex.cloud", "/"),
    /expected production backend/);
});

test("live release refuses a permissive enforced CSP before fetching assets", async () => {
  const paths = [];
  await assert.rejects(() => verifyLiveRelease({
    site: "https://release.example",
    expectedConvexUrl,
    fetchImpl: async url => {
      paths.push(new URL(url).pathname);
      return new Response('<div id="root"></div><script src="/assets/index.js"></script>', {
        headers: headers({ "content-security-policy": "default-src * 'unsafe-inline'" }),
      });
    },
  }), /CSP must match/);
  assert.deepEqual(paths, ["/"]);
});
