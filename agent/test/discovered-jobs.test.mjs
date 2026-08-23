import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DiscoveredJobValidationError,
  MatchDecisionValidationError,
  loadDiscoveredJob,
  loadMatchDecision,
  saveDiscoveredJob,
  saveMatchDecision,
  validateDiscoveredJob,
  validateMatchDecision,
} from "../store/discovered-jobs.mjs";

const timestamp = "2026-08-23T12:00:00.000Z";

function validJob() {
  return {
    schemaVersion: 1,
    id: "greenhouse-acme-123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    externalIds: { greenhouse: "123", requisition: "SEC-123" },
    source: { provider: "greenhouse", identifier: "acme", sourceUrl: "https://boards.greenhouse.io/acme" },
    role: {
      company: "Acme Security",
      title: "Principal Cloud Security Architect",
      location: "Nashville, TN",
      workplaceMode: "hybrid",
      employmentType: "full-time",
      industry: "cybersecurity",
      salary: { minimum: 190000, maximum: 230000, currency: "USD", basis: "annual" },
      workAuthorization: "required",
      clearance: "unknown",
    },
    description: { sha256: "a".repeat(64), localPath: "descriptions/greenhouse-acme-123.txt" },
    postedAt: timestamp,
    discoveredAt: timestamp,
    normalizedAt: timestamp,
    lifecycle: "active",
  };
}

function validDecision() {
  return {
    schemaVersion: 1,
    id: "greenhouse-acme-123-p1",
    jobId: "greenhouse-acme-123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    profileVersion: 1,
    decidedAt: timestamp,
    outcome: "needs-review",
    hardFilterResults: [
      { ruleId: "WORKPLACE_MODE", outcome: "pass", reasonCode: "WORKPLACE_MODE_ALLOWED" },
      { ruleId: "CLEARANCE", outcome: "unknown", reasonCode: "CLEARANCE_UNKNOWN" },
    ],
    score: 82,
    subscores: { role: 100, seniority: 100, framework: 75, cloudPlatform: 100, expertise: 75, preference: 50 },
    explanationCodes: ["ROLE_MATCH", "CLEARANCE_UNKNOWN"],
    reviewerOverride: null,
  };
}

test("persists validated discovered jobs and decisions as local private records", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "career-ops-discovery-"));
  const job = saveDiscoveredJob(validJob(), rootPath);
  const decision = saveMatchDecision(validDecision(), rootPath);

  assert.deepEqual(loadDiscoveredJob(job.id, rootPath), job);
  assert.deepEqual(loadMatchDecision(decision.id, rootPath), decision);
  assert.equal(statSync(join(rootPath, "jobs", `${job.id}.json`)).mode & 0o777, 0o600);
  assert.equal(statSync(join(rootPath, "decisions", `${decision.id}.json`)).mode & 0o777, 0o600);
});

test("rejects invalid normalized records and unknown fields", () => {
  const job = validJob();
  job.role.workplaceMode = "distributed";
  job.lifecycle = "deleted";
  job.untracked = true;
  job.evidence = { frameworks: ["NIST CSF"], unexpected: true };
  const errors = validateDiscoveredJob(job);
  assert.ok(errors.some((error) => error.includes("workplaceMode")));
  assert.ok(errors.some((error) => error.includes("lifecycle")));
  assert.ok(errors.some((error) => error.includes("untracked")));
  assert.ok(errors.some((error) => error.includes("evidence.unexpected")));
  assert.throws(() => saveDiscoveredJob(job, mkdtempSync(join(tmpdir(), "career-ops-invalid-"))), DiscoveredJobValidationError);

  const decision = validDecision();
  decision.subscores.role = 101;
  decision.explanationCodes = ["human prose is not a stable code"];
  const decisionErrors = validateMatchDecision(decision);
  assert.ok(decisionErrors.some((error) => error.includes("subscores.role")));
  assert.ok(decisionErrors.some((error) => error.includes("explanationCodes")));
  assert.throws(() => saveMatchDecision(decision, mkdtempSync(join(tmpdir(), "career-ops-invalid-decision-"))), MatchDecisionValidationError);
});

test("rejects raw resume and job-description content from local record contracts", () => {
  const job = validJob();
  job.descriptionText = "We need a principal architect with AWS and NIST experience.";
  const jobErrors = validateDiscoveredJob(job);
  assert.ok(jobErrors.some((error) => error.includes("raw resume or job-description content")));
  assert.throws(() => saveDiscoveredJob(job, mkdtempSync(join(tmpdir(), "career-ops-raw-jd-"))), DiscoveredJobValidationError);

  const decision = validDecision();
  decision.reviewerOverride = {
    outcome: "ranked",
    reasonCode: "REVIEWER_APPROVED",
    reviewerId: "Dee",
    overriddenAt: timestamp,
    rawResume: "Full resume content must never be persisted in a match decision.",
  };
  const decisionErrors = validateMatchDecision(decision);
  assert.ok(decisionErrors.some((error) => error.includes("raw resume or job-description content")));
  assert.throws(() => saveMatchDecision(decision, mkdtempSync(join(tmpdir(), "career-ops-raw-resume-"))), MatchDecisionValidationError);
});
