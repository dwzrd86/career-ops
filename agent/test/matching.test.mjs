import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { createMatchDecision } from "../matching/score.mjs";
import { assertValidDiscoveredJob, assertValidMatchDecision } from "../store/discovered-jobs.mjs";
import { assertValidTargetProfile } from "../store/target-profile.mjs";

const fixtureDirectory = resolve("agent/test/fixtures/matching");
const timestamp = "2026-08-23T12:00:00.000Z";
const profile = assertValidTargetProfile(yaml.load(readFileSync(resolve(fixtureDirectory, "profile.yml"), "utf8")));

function fixture(name) {
  return assertValidDiscoveredJob(JSON.parse(readFileSync(resolve(fixtureDirectory, `${name}-job.json`), "utf8")));
}

test("hard filters reject excluded and deal-breaker jobs before ranking", () => {
  const decision = createMatchDecision(profile, fixture("rejected"), { decidedAt: timestamp });
  assertValidMatchDecision(decision);
  assert.equal(decision.outcome, "rejected");
  assert.equal(decision.score, null);
  assert.deepEqual(decision.explanationCodes, ["COMPANY_EXCLUDED", "DEAL_BREAKER_MATCHED", "RANKING_SKIPPED_HARD_FILTER"]);
  assert.deepEqual(decision.hardFilterResults.filter((entry) => entry.outcome === "fail").map((entry) => entry.ruleId), ["EXCLUDED_COMPANY", "DEAL_BREAKER"]);
});

test("unknown hard-filter facts produce a reviewable decision without inferred matches", () => {
  const decision = createMatchDecision(profile, fixture("needs-review"), { decidedAt: timestamp });
  assertValidMatchDecision(decision);
  assert.equal(decision.outcome, "needs-review");
  assert.equal(decision.score, 77.5);
  assert.ok(decision.explanationCodes.includes("SALARY_UNKNOWN"));
  assert.ok(decision.explanationCodes.includes("WORK_AUTHORIZATION_UNKNOWN"));
  assert.ok(decision.explanationCodes.includes("CLEARANCE_UNKNOWN"));
  assert.ok(decision.explanationCodes.includes("DEAL_BREAKER_UNKNOWN"));
});

test("explicit fixture evidence produces a stable ranked decision", () => {
  const decision = createMatchDecision(profile, fixture("ranked"), { decidedAt: timestamp });
  assertValidMatchDecision(decision);
  assert.equal(decision.outcome, "ranked");
  assert.equal(decision.score, 100);
  assert.deepEqual(decision.subscores, { role: 100, seniority: 100, framework: 100, cloudPlatform: 100, expertise: 100, preference: 100 });
  assert.ok(decision.hardFilterResults.every((entry) => entry.outcome === "pass" || entry.outcome === "not-applicable"));
});

test("an unresolved onsite or hybrid commute stays unknown instead of being inferred from a region", () => {
  const job = fixture("ranked");
  job.role.location = "Chicago, IL, United States";
  const decision = createMatchDecision(profile, job, { decidedAt: timestamp });
  assert.equal(decision.outcome, "needs-review");
  assert.ok(decision.explanationCodes.includes("LOCATION_DISTANCE_UNKNOWN"));
});
