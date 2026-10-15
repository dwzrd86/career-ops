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

test("dream industries can use any allowed region while ordinary hybrid roles keep location review", () => {
  const target = structuredClone(profile);
  target.location.preferredRegions = ["Nashville", "Dallas", "Colorado"];
  target.location.dreamAnyRegion = true;
  target.preferences.dreamIndustries = ["sports", "entertainment"];
  const job = fixture("ranked");
  job.role.location = "Chicago, IL, United States";
  job.role.industry = "sports and entertainment";
  const dream = createMatchDecision(target, job, { decidedAt: timestamp });
  assert.equal(dream.hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "DREAM_INDUSTRY_LOCATION_ALLOWED");
  assert.ok(dream.explanationCodes.includes("DREAM_INDUSTRY_MATCH"));

  job.role.industry = "cybersecurity";
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "LOCATION_DISTANCE_UNKNOWN");
  job.role.location = "Dallas, TX";
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "LOCATION_PREFERRED_REGION");
  job.role.industry = "sports";
  job.role.location = "Chicago, IL";
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "DREAM_INDUSTRY_REGION_UNKNOWN");
  job.role.location = "Remote, US";
  job.role.workplaceMode = "remote";
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "DREAM_INDUSTRY_LOCATION_ALLOWED");
});

test("explicit travel and office requirements enforce the configured limits", () => {
  const target = structuredClone(profile);
  target.criteria.maxTravelPercent = 50;
  target.criteria.maxOfficeDaysPerWeek = 4;
  const job = fixture("ranked");
  job.evidence.requirements = ["Travel up to 60%", "5 days per week in office"];
  const decision = createMatchDecision(target, job, { decidedAt: timestamp });
  assert.equal(decision.outcome, "rejected");
  assert.deepEqual(decision.hardFilterResults.filter((entry) => entry.outcome === "fail").map((entry) => entry.reasonCode), ["TRAVEL_EXCEEDS_LIMIT", "OFFICE_DAYS_EXCEEDS_LIMIT"]);
  job.evidence.requirements = ["Travel up to 30%", "3 days per week in office"];
  const acceptable = createMatchDecision(target, job, { decidedAt: timestamp });
  assert.equal(acceptable.hardFilterResults.find((entry) => entry.ruleId === "TRAVEL").outcome, "pass");
  assert.equal(acceptable.hardFilterResults.find((entry) => entry.ruleId === "OFFICE_DAYS").outcome, "pass");
  job.evidence.requirements = ["More than 50% travel"];
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "TRAVEL").reasonCode, "TRAVEL_EXCEEDS_LIMIT");
  job.evidence.requirements = ["Travel over 50%"];
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "TRAVEL").reasonCode, "TRAVEL_EXCEEDS_LIMIT");
});

test("dream locations outside the US reach review without assuming work authorization", () => {
  const target = structuredClone(profile);
  target.location.dreamRegions = ["London", "Barcelona"];
  const job = fixture("ranked");
  job.role.location = "London, UK";
  const london = createMatchDecision(target, job, { decidedAt: timestamp });
  assert.equal(london.outcome, "needs-review");
  assert.equal(london.hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "DREAM_LOCATION_ALLOWED");
  assert.equal(london.hardFilterResults.find((entry) => entry.ruleId === "WORK_AUTHORIZATION").reasonCode, "DREAM_LOCATION_WORK_AUTHORIZATION_UNKNOWN");

  job.role.location = "Barcelona, Spain";
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "DREAM_LOCATION_ALLOWED");
  target.location.dreamRegions = [];
  assert.equal(createMatchDecision(target, job, { decidedAt: timestamp }).hardFilterResults.find((entry) => entry.ruleId === "LOCATION").reasonCode, "LOCATION_OUTSIDE_ALLOWED_REGIONS");
});
