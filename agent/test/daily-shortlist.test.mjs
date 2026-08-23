import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateDailyShortlist } from "../daily-shortlist.mjs";
import { saveDiscoveredJob, saveMatchDecision } from "../store/discovered-jobs.mjs";
import { saveMaterialBundle } from "../evaluation/worker.mjs";

const NOW = "2026-08-23T12:00:00.000Z";

function root() { return mkdtempSync(join(tmpdir(), "career-ops-daily-shortlist-")); }

function job(id, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    canonicalUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    externalIds: { greenhouse: id },
    source: { provider: "greenhouse", identifier: "acme", sourceUrl: "https://boards.greenhouse.io/acme" },
    role: {
      company: "Acme Security",
      title: `Principal Architect ${id}`,
      location: "Remote - United States",
      workplaceMode: "remote",
      employmentType: "full-time",
      industry: "cybersecurity",
      salary: null,
      workAuthorization: "unknown",
      clearance: "unknown",
    },
    description: { sha256: "a".repeat(64), localPath: `details/${id}.txt` },
    postedAt: NOW,
    discoveredAt: NOW,
    normalizedAt: NOW,
    lifecycle: "active",
    ...overrides,
  };
}

function decision(jobRecord, overrides = {}) {
  return {
    schemaVersion: 1,
    id: `match-${jobRecord.id}-p3`,
    jobId: jobRecord.id,
    canonicalUrl: jobRecord.canonicalUrl,
    profileVersion: 3,
    decidedAt: NOW,
    outcome: "ranked",
    hardFilterResults: [{ ruleId: "WORKPLACE_MODE", outcome: "pass", reasonCode: "WORKPLACE_MODE_ALLOWED" }],
    score: 82,
    subscores: { role: 100, seniority: 100, framework: null, cloudPlatform: null, expertise: null, preference: null },
    explanationCodes: ["ROLE_PRIMARY_MATCH"],
    reviewerOverride: null,
    ...overrides,
  };
}

test("writes a private daily review artifact from active ranked current-profile decisions", () => {
  const dataRoot = root();
  const high = saveDiscoveredJob(job("high"), dataRoot);
  const low = saveDiscoveredJob(job("low", { normalizedAt: "2026-08-01T12:00:00.000Z" }), dataRoot);
  const historical = saveDiscoveredJob(job("historical"), dataRoot);
  const overridden = saveDiscoveredJob(job("overridden"), dataRoot);
  const expired = saveDiscoveredJob(job("expired", { lifecycle: "expired" }), dataRoot);
  saveMatchDecision(decision(high, { score: 91 }), dataRoot);
  saveMatchDecision(decision(low, { score: 42 }), dataRoot);
  saveMatchDecision(decision(historical, { id: "match-historical-p2", profileVersion: 2, score: 99 }), dataRoot);
  saveMatchDecision(decision(overridden, {
    reviewerOverride: { outcome: "rejected", reasonCode: "REVIEWER_REJECTED", reviewerId: "owner", overriddenAt: NOW },
  }), dataRoot);
  saveMatchDecision(decision(expired), dataRoot);

  const result = generateDailyShortlist({ rootPath: dataRoot, profileVersion: 3, now: NOW });
  const markdown = readFileSync(result.artifactPath, "utf8");

  assert.equal(result.reviewCount, 2);
  assert.equal(result.projectedCount, 0);
  assert.equal(result.projectionPath, null);
  assert.ok(markdown.indexOf("Principal Architect high") < markdown.indexOf("Principal Architect low"));
  assert.match(markdown, /Generated locally/);
  assert.match(markdown, /does not evaluate roles, generate materials, submit applications, send email, or contact a third party/);
  assert.doesNotMatch(markdown, /historical|overridden|expired|details\//);
  assert.equal(statSync(result.artifactPath).mode & 0o777, 0o600);
});

test("writes a bounded Convex-compatible payload only when explicitly requested", () => {
  const dataRoot = root();
  const safe = saveDiscoveredJob(job("safe"), dataRoot);
  const insecure = saveDiscoveredJob(job("insecure", { canonicalUrl: "http://boards.greenhouse.io/acme/jobs/insecure" }), dataRoot);
  saveMatchDecision(decision(safe), dataRoot);
  saveMatchDecision(decision(insecure), dataRoot);

  const result = generateDailyShortlist({ rootPath: dataRoot, profileVersion: 3, now: NOW, includeProjection: true });
  const projection = JSON.parse(readFileSync(result.projectionPath, "utf8"));
  const encoded = JSON.stringify(projection);

  assert.equal(result.reviewCount, 2);
  assert.equal(result.projectedCount, 1);
  assert.equal(projection.kind, "career-ops/convex-discovery-project");
  assert.deepEqual(Object.keys(projection.items[0]).sort(), ["company", "decision", "discoveredAt", "freshness", "localJobId", "location", "source", "title", "url"]);
  assert.equal(projection.items[0].localJobId, "safe");
  assert.equal(projection.items[0].decision.outcome, "ranked");
  assert.doesNotMatch(encoded, /localPath|description|resume|details\//i);
  assert.equal(statSync(result.projectionPath).mode & 0o777, 0o600);
});

test("adds read-only material status without local paths to local and private review projections", () => {
  const dataRoot = root();
  const safe = saveDiscoveredJob(job("materials"), dataRoot);
  saveMatchDecision(decision(safe), dataRoot);
  saveMaterialBundle({
    schemaVersion: 1,
    id: "bundle-materials",
    requestId: "eval-materials",
    jobId: safe.id,
    targetProfileVersion: 3,
    normalizedJdSnapshot: { sha256: "a".repeat(64), localPath: "details/materials.txt" },
    evidenceReferences: [{ kind: "resume", label: "Primary resume", localPath: "cv.md" }],
    reportPath: "reports/materials.md",
    pdfPath: "output/materials.pdf",
    checklistPath: "materials/materials-checklist.md",
    reviewState: "draft-awaiting-review",
    createdAt: NOW,
  }, dataRoot);

  const result = generateDailyShortlist({ rootPath: dataRoot, profileVersion: 3, now: NOW, includeProjection: true });
  const markdown = readFileSync(result.artifactPath, "utf8");
  const projection = JSON.parse(readFileSync(result.projectionPath, "utf8"));

  assert.match(markdown, /draft awaiting review \(report, PDF, checklist\)/);
  assert.deepEqual(projection.items[0].materialStatus, {
    artifacts: { checklistReady: true, pdfReady: true, reportReady: true },
    createdAt: Date.parse(NOW),
    reviewState: "draftAwaitingReview",
    targetProfileVersion: 3,
  });
  assert.doesNotMatch(`${markdown}\n${JSON.stringify(projection)}`, /localPath|details\/|cv\.md|materials\.pdf|materials-checklist/i);
});

test("rejects an invalid calendar date before creating a local artifact", () => {
  assert.throws(
    () => generateDailyShortlist({ rootPath: root(), profileVersion: 3, now: NOW, date: "2026-02-31" }),
    /date must use YYYY-MM-DD/,
  );
});
