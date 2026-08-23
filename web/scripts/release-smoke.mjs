import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const requiredHeaders = {
  "cache-control": "no-cache, no-store, must-revalidate",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function failure(message) {
  throw new Error(`Release smoke test: ${message}`);
}

function requireOption(args, name) {
  const value = args[args.indexOf(name) + 1];
  if (!value || value.startsWith("--")) failure(`${name} is required`);
  return value;
}

function normalizeSiteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") failure("--site must be an HTTPS origin");
  if (url.pathname !== "/" || url.search || url.hash) failure("--site must be an origin without a path, query, or fragment");
  return url;
}

function normalizeConvexUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud") || url.pathname !== "/" || url.search || url.hash) {
    failure("--expected-convex-url must be an HTTPS Convex deployment origin");
  }
  return url.origin;
}

function header(response, name) {
  return response.headers.get(name) ?? "";
}

export function bundleUrls(html, siteUrl) {
  const sourceUrls = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(([, value]) => new URL(value, siteUrl));
  const bundles = sourceUrls.filter((url) => url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js"));
  if (bundles.length === 0) failure("HTML did not reference a JavaScript bundle under /assets/");
  if (bundles.some((url) => url.origin !== siteUrl.origin)) failure("HTML referenced a JavaScript bundle outside the release origin");
  return bundles;
}

function assertHeaders(response, label) {
  for (const [name, expected] of Object.entries(requiredHeaders)) {
    assert.equal(header(response, name), expected, `${label} must send ${name}: ${expected}`);
  }

  const csp = header(response, "content-security-policy");
  assert.ok(csp, `${label} must send an enforced Content-Security-Policy`);
  assert.equal(header(response, "content-security-policy-report-only"), "", `${label} must not retain a report-only CSP after enforcement`);
}

export async function verifyLiveRelease({ site, expectedConvexUrl, fetchImpl = fetch }) {
  const siteUrl = normalizeSiteUrl(site);
  const expectedConvexOrigin = normalizeConvexUrl(expectedConvexUrl);
  const homeResponse = await fetchImpl(siteUrl, { redirect: "error" });
  assert.equal(homeResponse.status, 200, "anonymous entry route must return HTTP 200");
  assertHeaders(homeResponse, "/");
  const html = await homeResponse.text();
  assert.match(html, /<div\s+id=["']root["']><\/div>/i, "anonymous entry route must serve the SPA shell, not protected pipeline data");

  const indexResponse = await fetchImpl(new URL("/index.html", siteUrl), { redirect: "error" });
  assert.equal(indexResponse.status, 200, "/index.html must return HTTP 200");
  assertHeaders(indexResponse, "/index.html");

  for (const bundleUrl of bundleUrls(html, siteUrl)) {
    const bundleResponse = await fetchImpl(bundleUrl, { redirect: "error" });
    assert.equal(bundleResponse.status, 200, `${bundleUrl.pathname} must return HTTP 200`);
    assert.equal(header(bundleResponse, "cache-control"), "public, max-age=31536000, immutable", `${bundleUrl.pathname} must have immutable asset caching`);
    const bundle = await bundleResponse.text();
    const convexUrls = [...new Set(bundle.match(/https:\/\/[^\s"'\\]+\.convex\.cloud\b/g) || [])];
    assert.deepEqual(convexUrls, [expectedConvexOrigin], `${bundleUrl.pathname} must embed only the expected production Convex URL`);
  }

  return { site: siteUrl.origin, bundles: bundleUrls(html, siteUrl).map((url) => url.pathname) };
}

async function verifyAnonymousBrowserRoute(site) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(site, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Welcome back." }).waitFor({ state: "visible", timeout: 10_000 });
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const site = requireOption(args, "--site");
  const expectedConvexUrl = requireOption(args, "--expected-convex-url");
  const result = await verifyLiveRelease({ site, expectedConvexUrl });
  if (!args.includes("--skip-browser")) {
    await verifyAnonymousBrowserRoute(result.site);
    const run = spawnSync("npm", ["run", "test:browser-flow"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit" });
    if (run.status !== 0) failure("authenticated isolated-browser flow failed");
  }
  console.log(`Release smoke test passed for ${result.site} (${result.bundles.join(", ")})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
