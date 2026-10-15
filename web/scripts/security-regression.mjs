import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const webDirectory = resolve(scriptDirectory, "..");
const productionUrl = "https://security-regression-production.convex.cloud";
const developmentUrl = "https://security-regression-development.convex.cloud";
const turnstileSiteKey = "1x00000000000000000000AA";
const REQUIRED_NODE_MAJOR = 24;

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor !== REQUIRED_NODE_MAJOR) {
  console.error(`Security regression requires Node.js ${REQUIRED_NODE_MAJOR}.x (found v${process.versions.node}).`);
  process.exit(1);
}
const scratchDirectory = resolve(webDirectory, "../agent/.local");
mkdirSync(scratchDirectory, { recursive: true });
const buildDirectory = mkdtempSync(resolve(scratchDirectory, "security-build-"));

const checks = [
  {
    name: "production dependency audit",
    command: "npm",
    args: ["audit", "--package-lock-only", "--omit=dev", "--audit-level=high"],
  },
  { name: "authorization tests", command: "npm", args: ["run", "test:auth"] },
  { name: "production build guard tests", command: "npm", args: ["run", "test:production-build-guard"] },
  { name: "read-only release preflight tests", command: "npm", args: ["run", "test:release-preflight"] },
  {
    name: "guarded production build and endpoint verification",
    command: "npm",
    args: ["run", "build", "--", "--out-dir", buildDirectory],
    env: {
      CONVEX_DEV_DEPLOYMENT_URLS: developmentUrl,
      VITE_CONVEX_URL: productionUrl,
      VITE_TURNSTILE_SITE_KEY: turnstileSiteKey,
    },
  },
  {
    name: "production bundle endpoint verification",
    command: "npm",
    args: ["run", "verify:production-build", "--", "--out-dir", buildDirectory],
    env: {
      CONVEX_DEV_DEPLOYMENT_URLS: developmentUrl,
      VITE_CONVEX_URL: productionUrl,
      VITE_TURNSTILE_SITE_KEY: turnstileSiteKey,
    },
  },
  { name: "security headers and CSP checks", command: "npm", args: ["run", "test:security-headers"] },
  { name: "compiled browser workflow under enforced CSP", command: "npm", args: ["run", "test:browser-csp"] },
  { name: "release smoke regression", command: "npm", args: ["run", "test:release-smoke"] },
  { name: "isolated browser account and pipeline flow", command: "npm", args: ["run", "test:browser-flow"] },
];

const failures = [];
console.log("Security regression: starting");

try {
  for (const check of checks) {
    const result = spawnSync(check.command, check.args, {
      cwd: webDirectory,
      encoding: "utf8",
      env: { ...process.env, ...check.env },
      stdio: "pipe",
      timeout: 120_000,
    });
    if (result.status === 0) {
      console.log(`PASS ${check.name}`);
    } else {
      failures.push(check.name);
      console.log(`FAIL ${check.name}`);
    }
  }
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Security regression failed: ${failures.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log(`Security regression passed: ${checks.length} checks`);
}
