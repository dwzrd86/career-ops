import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluatePreflight, parseOptions, readServerNames, requiredServerNames } from "./release-preflight.mjs";

const expectedUrl = "https://beaming-bass-637.convex.cloud";
const developmentUrl = "https://development-fixture.convex.cloud";
const fixture = {
  expectedUrl, nodeVersion: "24.19.0", localDevelopmentUrl: developmentUrl,
  env: { CONVEX_DEPLOY_KEY: "fixture", CONVEX_DEV_DEPLOYMENT_URLS: developmentUrl,
    VITE_TURNSTILE_SITE_KEY: "fixture-public-key", VITE_APP_DEPLOYMENT_VERSION: "fixture-version" },
  verify: () => {}, serverNames: new Set(requiredServerNames),
};
const failures = options => evaluatePreflight({ ...fixture, ...options }).filter(check => !check.pass).map(check => check.name);

test("requires an explicit backend and rejects unknown or repeated arguments", () => {
  assert.throws(() => parseOptions([]), /explicit/);
  assert.throws(() => parseOptions(["--expected-convex-url", "https://example.com"]));
  assert.throws(() => parseOptions(["--prod"]));
  assert.throws(() => parseOptions(["--expected-convex-url", expectedUrl, "--expected-convex-url", expectedUrl]));
  assert.deepEqual(parseOptions(["--expected-convex-url", expectedUrl, "--check-convex-env"]), { expectedUrl, checkConvexEnv: true });
});

test("passes configured fixture and reports every missing setting without values", () => {
  assert.deepEqual(failures({}), []);
  const result = failures({ env: {}, serverNames: new Set(["SITE_URL"]) });
  assert.ok(result.includes("build setting CONVEX_DEPLOY_KEY"));
  for (const name of requiredServerNames.filter(name => name !== "SITE_URL")) assert.ok(result.includes(`Convex setting ${name}`));
});

test("rejects an intended backend blocked by the reviewed CSP", () => {
  assert.ok(failures({ expectedUrl: developmentUrl }).includes("reviewed CSP allows the intended production backend"));
});

test("rejects incomplete development denylists and production aliases", () => {
  for (const denylist of [expectedUrl, "https://different-dev.convex.cloud", "invalid", ""]) {
    assert.ok(failures({ env: { ...fixture.env, CONVEX_DEV_DEPLOYMENT_URLS: denylist } })
      .includes("development URL denylist includes the local development deployment"));
  }
});

test("rejects wrong build overrides, runtime and stale bundle without disclosing errors", () => {
  const result = failures({ nodeVersion: "22.23.3", env: { ...fixture.env, VITE_CONVEX_SITE_URL: "https://wrong.convex.site" },
    verify: () => { throw new Error("sensitive-provider-message"); } });
  assert.equal(result.length, 3);
  assert.ok(!JSON.stringify(result).includes("sensitive-provider-message"));
  assert.ok(!JSON.stringify(result).includes(fixture.env.CONVEX_DEPLOY_KEY));
  assert.deepEqual(failures({ env: { ...fixture.env, VITE_CONVEX_URL: expectedUrl,
    VITE_CONVEX_SITE_URL: expectedUrl.replace(/\.cloud$/, ".site") } }), []);
});

test("provider audit requests only names on the explicitly selected deployment", () => {
  const names = readServerNames(expectedUrl, (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args.slice(1), ["env", "list", "--names-only", "--deployment", "beaming-bass-637"]);
    assert.equal(options.stdio, "pipe");
    assert.equal(options.timeout, 30_000);
    return { status: 0, stdout: "SITE_URL\nAUTH_RESEND_KEY\n" };
  });
  assert.deepEqual([...names], ["SITE_URL", "AUTH_RESEND_KEY"]);
  assert.throws(() => readServerNames(expectedUrl, () => ({ status: 1, stderr: "private-provider-data" })), /diagnostics were suppressed/);
  assert.throws(() => readServerNames(expectedUrl, () => ({ status: 0, stdout: "SECRET=private-provider-data" })), /diagnostics were suppressed/);
});

test("CLI fails closed and never echoes malformed command arguments", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./release-preflight.mjs", import.meta.url)),
    "--expected-convex-url", "private-command-data"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("private-command-data"));
});
