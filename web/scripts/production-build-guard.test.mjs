import assert from "node:assert/strict";
import test from "node:test";
import {
  embeddedConvexUrls,
  parseDeploymentUrl,
  validateTurnstileSiteKey,
  validateProductionUrl,
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
