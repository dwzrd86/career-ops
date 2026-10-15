import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleasePolicy, configuredSecurityPolicy } from "./security-policy.mjs";
import { developmentDeploymentUrls, parseDeploymentUrl, verifyDist } from "./production-build-guard.mjs";

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
export const requiredServerNames = [
  "BETTER_AUTH_SECRET", "SITE_URL", "AUTH_TURNSTILE_SECRET", "AUTH_TURNSTILE_HOSTNAME",
  "AUTH_RESEND_FROM", "AUTH_RESEND_KEY", "AUTH_ABUSE_KEY", "ENROLLMENT_INVITE_KEY",
  "ENROLLMENT_ADMIN_KEY", "APP_DEPLOYMENT_VERSION",
];
const requiredBuildNames = ["CONVEX_DEPLOY_KEY", "CONVEX_DEV_DEPLOYMENT_URLS",
  "VITE_TURNSTILE_SITE_KEY", "VITE_APP_DEPLOYMENT_VERSION"];

export function parseOptions(args) {
  const options = { checkConvexEnv: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check-convex-env" && !options.checkConvexEnv) options.checkConvexEnv = true;
    else if (args[index] === "--expected-convex-url" && !options.expectedUrl && args[index + 1]) {
      options.expectedUrl = parseDeploymentUrl(args[++index]);
    } else throw new Error("Use --expected-convex-url <https://deployment.convex.cloud> [--check-convex-env].");
  }
  if (!options.expectedUrl) throw new Error("An explicit --expected-convex-url is required; local development is never the default.");
  return options;
}

export function evaluatePreflight({ expectedUrl, env = process.env, nodeVersion = process.versions.node,
  policy = configuredSecurityPolicy(), localDevelopmentUrl, verify = verifyDist, serverNames }) {
  const checks = [];
  const check = (name, run) => {
    try { run(); checks.push({ name, pass: true }); }
    // Diagnostics are fixed strings: never propagate provider output or environment values.
    catch { checks.push({ name, pass: false }); }
  };
  check("Node.js 24", () => { if (nodeVersion.split(".")[0] !== "24") throw new Error(); });
  check("reviewed CSP allows the intended production backend", () => assertReleasePolicy(policy, expectedUrl, "Preflight"));
  for (const name of requiredBuildNames) {
    check(`build setting ${name}`, () => { if (!env[name]?.trim()) throw new Error(); });
  }
  check("development URL denylist includes the local development deployment", () => {
    const developmentUrls = developmentDeploymentUrls(env.CONVEX_DEV_DEPLOYMENT_URLS);
    if (!developmentUrls.length || developmentUrls.includes(expectedUrl)) throw new Error();
    if (localDevelopmentUrl && (!developmentUrls.includes(localDevelopmentUrl) || localDevelopmentUrl === expectedUrl)) throw new Error();
  });
  check("optional build endpoint overrides match the intended production backend", () => {
    if (env.VITE_CONVEX_URL && env.VITE_CONVEX_URL !== expectedUrl) throw new Error();
    if (env.VITE_CONVEX_SITE_URL && env.VITE_CONVEX_SITE_URL !== expectedUrl.replace(/\.cloud$/, ".site")) throw new Error();
  });
  check("existing dist contains only the intended production backend", () => verify(expectedUrl));
  if (serverNames !== undefined) {
    for (const name of requiredServerNames) {
      check(`Convex setting ${name}`, () => { if (!serverNames.has(name)) throw new Error(); });
    }
  }
  return checks;
}

export function readServerNames(expectedUrl, run = spawnSync) {
  const deployment = new URL(parseDeploymentUrl(expectedUrl)).hostname.replace(/\.convex\.cloud$/, "");
  const result = run(process.execPath, [resolve(webDirectory, "node_modules/convex/bin/main.js"),
    "env", "list", "--names-only", "--deployment", deployment], {
    cwd: webDirectory, encoding: "utf8", timeout: 30_000, stdio: "pipe",
  });
  if (result.status !== 0 || result.error) throw new Error("Could not read Convex variable names. Check provider access; diagnostics were suppressed.");
  const names = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (names.some(name => !/^[A-Z][A-Z0-9_]*$/.test(name))) throw new Error("Unexpected Convex names-only output; diagnostics were suppressed.");
  return new Set(names);
}

function localDevelopmentUrl() {
  try {
    const source = readFileSync(resolve(webDirectory, ".env.local"), "utf8");
    const deployment = source.match(/^CONVEX_DEPLOYMENT\s*=\s*["']?dev:([a-z0-9-]+)/m)?.[1];
    return deployment ? `https://${deployment}.convex.cloud` : undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error("Could not inspect the local development deployment.");
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const checks = evaluatePreflight({ expectedUrl: options.expectedUrl, localDevelopmentUrl: localDevelopmentUrl() });
  if (options.checkConvexEnv) {
    try {
      const names = readServerNames(options.expectedUrl);
      for (const name of requiredServerNames) checks.push({ name: `Convex setting ${name}`, pass: names.has(name) });
    } catch {
      checks.push({ name: "Convex names-only audit (provider access required; diagnostics suppressed)", pass: false });
    }
  }
  for (const check of checks) console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}`);
  console.log("Read-only preflight; no deployment or configuration changes were made.");
  console.log("Still required: provider value/scope review, approved usage limits and notification recipients, release smoke, and real-account discovery-to-export verification.");
  if (!options.checkConvexEnv) console.log("Convex configuration was not audited. Add --check-convex-env for a names-only provider check.");
  process.exitCode = checks.every(check => check.pass) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {
    console.error("Preflight could not run. Use --expected-convex-url <https://deployment.convex.cloud> [--check-convex-env]. No values or provider diagnostics were printed.");
    process.exitCode = 1;
  }
}
