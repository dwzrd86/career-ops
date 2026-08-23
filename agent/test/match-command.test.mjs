import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(".");
const fixtureDirectory = resolve("agent/test/fixtures/matching");

function run(args) {
  return spawnSync(process.execPath, ["agent/commands/match.mjs", ...args], { cwd: root, encoding: "utf8" });
}

test("match command prints a validated explainable decision for a normalized fixture", () => {
  const result = run(["--profile", resolve(fixtureDirectory, "profile.yml"), "--job", resolve(fixtureDirectory, "ranked-job.json")]);
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.outcome, "ranked");
  assert.equal(decision.score, 100);
  assert.equal(decision.profileVersion, 4);
});

test("match command refuses to run without a valid saved Target Profile", () => {
  const result = run(["--profile", resolve(fixtureDirectory, "missing-profile.yml"), "--job", resolve(fixtureDirectory, "ranked-job.json")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Target Profile not found/);
});
