import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reuse the release policy for both the compiled browser fixture and live checks.
export function configuredSecurityPolicy() {
  const config = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
  const policy = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(policy, "An enforced production policy is required");
  return policy;
}

function directives(policy) {
  const result = Object.create(null);
  for (const entry of policy.split(";").map(value => value.trim()).filter(Boolean)) {
    const [name, ...sources] = entry.split(/\s+/);
    assert.ok(!Object.hasOwn(result, name), `Duplicate CSP directive: ${name}`);
    result[name] = [...new Set(sources)].sort();
  }
  return result;
}

export function assertReleasePolicy(policy, expectedConvexOrigin, label) {
  const expected = directives(configuredSecurityPolicy());
  const url = new URL(expectedConvexOrigin);
  const requiredConnections = [url.origin, `wss://${url.hostname}`, url.origin.replace(/\.cloud$/, ".site")];
  for (const origin of requiredConnections) {
    assert.ok(expected["connect-src"]?.includes(origin),
      `Configured CSP must allow the expected production backend: ${origin}`);
  }
  assert.deepEqual(directives(policy), expected,
    `${label} CSP must match the reviewed release policy`);
}
