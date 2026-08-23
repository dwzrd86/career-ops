import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { persistUniqueDiscoveredJob } from "../collectors/deduplicate.mjs";
import { normalizeCandidate } from "../collectors/normalize.mjs";
import { generateDailyShortlist } from "../daily-shortlist.mjs";
import { enqueueApprovedJob } from "../evaluation/queue.mjs";
import { processNextEvaluation } from "../evaluation/worker.mjs";
import { createMatchDecision } from "../matching/score.mjs";
import { saveMatchDecision } from "../store/discovered-jobs.mjs";
import { saveTargetProfile } from "../store/target-profile.mjs";

const NOW = "2026-08-23T12:00:00.000Z";
const FIXTURES = resolve("agent/test/fixtures/matching");
const LOCAL_TEST_ROOT = resolve("agent/.local");

function disposableProfile(rootPath) {
  const profile = yaml.load(readFileSync(join(FIXTURES, "profile.yml"), "utf8"));
  profile.profileVersion = 0;
  profile.updatedAt = null;
  profile.evidenceReferences = [{
    kind: "resume",
    localPath: "evidence/disposable-resume.txt",
    label: "Disposable dry-run resume reference",
    updatedAt: NOW,
  }];
  mkdirSync(join(rootPath, "evidence"), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootPath, "evidence", "disposable-resume.txt"), "Fixture evidence only.\n", { mode: 0o600 });
  return saveTargetProfile(profile, join(rootPath, "profile", "target-profile.yml"));
}

function greenhouseFixtureCandidate() {
  return {
    provider: "greenhouse",
    sourceIdentifier: "trusted-security",
    sourceUrl: "https://boards.greenhouse.io/trusted-security",
    externalId: "fixture-102",
    url: "https://boards.greenhouse.io/trusted-security/jobs/fixture-102?utm_source=dry-run",
    company: "Trusted Security",
    title: "Principal Cloud Security Architect",
    location: "Nashville, TN, United States",
    workplaceMode: "hybrid",
    employmentType: "full-time",
    industry: "cybersecurity",
    salary: { minimum: 190000, maximum: 230000, currency: "USD", basis: "annual" },
    workAuthorization: "required",
    clearance: "not-required",
    evidence: {
      seniority: "Principal",
      frameworks: ["NIST CSF", "ISO 27001"],
      cloudPlatforms: ["AWS", "Azure"],
      expertise: ["IAM", "Security architecture"],
      requirements: [],
    },
    descriptionText: "Fixture-only job detail for a controlled local dry run.",
    postedAt: NOW,
  };
}

test("controlled end-to-end dry run remains local, draft-only, and non-submitting", async () => {
  mkdirSync(LOCAL_TEST_ROOT, { recursive: true, mode: 0o700 });
  const rootPath = mkdtempSync(join(LOCAL_TEST_ROOT, "controlled-dry-run-"));
  const outboundCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    outboundCalls.push(args);
    throw new Error("Controlled dry run must not make a network request.");
  };

  try {
    const profile = disposableProfile(rootPath);
    const normalized = normalizeCandidate(greenhouseFixtureCandidate(), { now: NOW, rootPath });
    const saved = persistUniqueDiscoveredJob(normalized, { rootPath });
    const duplicate = persistUniqueDiscoveredJob(normalized, { rootPath });
    assert.equal(saved.outcome, "active");
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(duplicate.reasonCode, "DUPLICATE_CANONICAL_URL");
    assert.doesNotMatch(JSON.stringify(saved.savedJob), /Fixture-only job detail/);

    const decision = saveMatchDecision(createMatchDecision(profile, saved.savedJob, { decidedAt: NOW }), rootPath);
    assert.equal(decision.outcome, "ranked");

    const request = enqueueApprovedJob({
      jobId: saved.savedJob.id,
      approval: { status: "approved-for-evaluation", approvedBy: "fixture-reviewer", approvedAt: NOW },
      profile,
      rootPath,
      now: NOW,
    });

    const result = await processNextEvaluation({
      rootPath,
      now: NOW,
      evaluator: async (context) => {
        assert.equal(context.requestId, request.id);
        assert.equal(context.draftOnly, true);
        assert.equal(context.submissionAllowed, false);
        const drafts = join(rootPath, "drafts");
        mkdirSync(drafts, { recursive: true, mode: 0o700 });
        writeFileSync(join(drafts, "fixture-report.md"), "# [DRAFT] Fixture evaluation report\n", { mode: 0o600 });
        writeFileSync(join(drafts, "fixture-checklist.md"), "# [DRAFT] Manual application checklist\n", { mode: 0o600 });
        return {
          reportPath: "drafts/fixture-report.md",
          checklistPath: "drafts/fixture-checklist.md",
        };
      },
    });
    assert.equal(result.bundle.reviewState, "draft-awaiting-review");
    assert.equal(result.bundle.pdfPath, null);

    const shortlist = generateDailyShortlist({
      rootPath,
      profileVersion: profile.profileVersion,
      now: NOW,
      includeProjection: true,
    });
    const projection = JSON.parse(readFileSync(shortlist.projectionPath, "utf8"));
    assert.equal(shortlist.reviewCount, 1);
    assert.equal(shortlist.projectedCount, 1);
    assert.deepEqual(Object.keys(projection.items[0]).sort(), ["company", "decision", "discoveredAt", "freshness", "localJobId", "location", "materialStatus", "source", "title", "url"]);
    assert.doesNotMatch(JSON.stringify(projection), /description|localPath|evidence|disposable-resume|fixture-report|fixture-checklist/i);
    assert.equal(outboundCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(rootPath, { recursive: true, force: true });
  }
});
