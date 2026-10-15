import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  embeddedConvexUrls,
  parseDeploymentUrl,
  validateTurnstileSiteKey,
  validateProductionUrl,
  verifyDist,
} from "./production-build-guard.mjs";

const productionUrl = "https://production-release-test.convex.cloud";
const developmentUrl = "https://development-release-test.convex.cloud";

test("accepts a production Convex deployment URL", () => {
  assert.equal(parseDeploymentUrl(productionUrl), productionUrl);
});

test("rejects malformed or non-Convex deployment URLs", () => {
  assert.throws(() => parseDeploymentUrl("http://localhost:3210"), /HTTPS Convex/);
  assert.throws(() => parseDeploymentUrl("https://example.com"), /HTTPS Convex/);
  assert.throws(() => parseDeploymentUrl(`${productionUrl}/api`), /without a path/);
});

test("rejects a production build that targets a known development deployment", () => {
  assert.throws(
    () => validateProductionUrl({ productionUrl: developmentUrl, developmentUrls: [developmentUrl] }),
    /matches a development deployment URL/,
  );
});

test("requires the public bot-protection site key for production builds", () => {
  assert.equal(validateTurnstileSiteKey("1x00000000000000000000AA"), "1x00000000000000000000AA");
  assert.throws(() => validateTurnstileSiteKey(""), /VITE_TURNSTILE_SITE_KEY/);
});

test("finds unique Convex URLs embedded in a bundle", () => {
  assert.deepEqual(
    embeddedConvexUrls(`const url = \"${productionUrl}\"; const same = \"${productionUrl}\";`),
    [productionUrl],
  );
});

test("isolated bundle verification rejects missing, mixed, and stale endpoints", () => {
  const scratch = fileURLToPath(new URL("../../agent/.local/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(resolve(scratch, "guard-test-"));
  try {
    assert.throws(() => verifyDist(productionUrl, directory), /no JavaScript/);
    writeFileSync(resolve(directory, "app.js"), `const backend = '${productionUrl}';`);
    verifyDist(productionUrl, directory);
    writeFileSync(resolve(directory, "stale.js"), `const backend = '${developmentUrl}';`);
    assert.throws(() => verifyDist(productionUrl, directory), /only the expected/);
    rmSync(resolve(directory, "app.js"));
    assert.throws(() => verifyDist(productionUrl, directory), /only the expected/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("verification CLI uses the requested output directory and rejects unknown options", () => {
  const scratch = fileURLToPath(new URL("../../agent/.local/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(resolve(scratch, "guard-cli-test-"));
  const script = fileURLToPath(new URL("./production-build-guard.mjs", import.meta.url));
  const env = { ...process.env, VITE_CONVEX_URL: productionUrl,
    CONVEX_DEV_DEPLOYMENT_URLS: developmentUrl, VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" };
  try {
    mkdirSync(resolve(directory, "assets"));
    writeFileSync(resolve(directory, "assets/app.js"), `const backend = '${productionUrl}';`);
    const result = spawnSync(process.execPath, [script, "verify", "--out-dir", directory], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(resolve(directory, "assets/app.js"), `const backend = '${developmentUrl}';`);
    const stale = spawnSync(process.execPath, [script, "verify", "--out-dir", directory], { env, encoding: "utf8" });
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /only the expected/);
    const unknown = spawnSync(process.execPath, [script, "verify", "--output", directory], { env, encoding: "utf8" });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /only supported option/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
