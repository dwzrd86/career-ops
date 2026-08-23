import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findDuplicate, persistUniqueDiscoveredJob } from "../collectors/deduplicate.mjs";
import { canonicalizeUrl, normalizeCandidate } from "../collectors/normalize.mjs";
import { listDiscoveredJobs } from "../store/discovered-jobs.mjs";
import { countScanOutcomes, loadScanRun, saveScanRun, ScanRunValidationError } from "../store/scan-runs.mjs";

const timestamp = "2026-08-23T12:00:00.000Z";

function candidate(overrides = {}) {
  return {
    provider: "greenhouse",
    sourceIdentifier: "acme",
    sourceUrl: "https://boards.greenhouse.io/acme",
    externalId: "123",
    url: "https://boards.greenhouse.io/acme/jobs/123?utm_source=weekly#role",
    company: " Acme Security ",
    title: " Principal Cloud Security Architect ",
    location: "Remote - United States",
    employmentType: "full-time",
    descriptionText: "A private job detail snapshot that must never enter a record log.",
    postedAt: timestamp,
    ...overrides,
  };
}

test("normalizes ATS metadata and stores detail text only in ignored local detail storage", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "career-ops-collector-"));
  const job = normalizeCandidate(candidate(), { now: timestamp, rootPath });

  assert.equal(job.canonicalUrl, "https://boards.greenhouse.io/acme/jobs/123");
  assert.equal(job.role.company, "Acme Security");
  assert.equal(job.description.localPath, `details/${job.description.sha256}.txt`);
  assert.equal(JSON.stringify(job).includes("private job detail"), false);
  const snapshotPath = join(rootPath, job.description.localPath);
  assert.ok(existsSync(snapshotPath));
  assert.equal(readFileSync(snapshotPath, "utf8").includes("private job detail"), true);
  assert.equal(statSync(snapshotPath).mode & 0o777, 0o600);
});

test("deduplicates by canonical URL, provider external ID, and normalized role identity in order", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "career-ops-dedup-"));
  const first = normalizeCandidate(candidate(), { now: timestamp, rootPath });
  const saved = persistUniqueDiscoveredJob(first, { rootPath });
  assert.equal(saved.outcome, "active");

  const urlDuplicate = normalizeCandidate(candidate({ url: "https://boards.greenhouse.io/acme/jobs/123?utm_campaign=August" }), { now: timestamp, rootPath });
  assert.equal(persistUniqueDiscoveredJob(urlDuplicate, { rootPath }).reasonCode, "DUPLICATE_CANONICAL_URL");

  const idDuplicate = normalizeCandidate(candidate({ url: "https://boards.greenhouse.io/acme/jobs/456", title: "Different title" }), { now: timestamp, rootPath });
  assert.equal(persistUniqueDiscoveredJob(idDuplicate, { rootPath }).reasonCode, "DUPLICATE_PROVIDER_EXTERNAL_ID");

  const roleDuplicate = normalizeCandidate(candidate({ url: "https://boards.greenhouse.io/acme/jobs/789", externalId: "789" }), { now: timestamp, rootPath });
  assert.equal(persistUniqueDiscoveredJob(roleDuplicate, { rootPath }).reasonCode, "DUPLICATE_COMPANY_TITLE_LOCATION");
  assert.equal(listDiscoveredJobs(rootPath).length, 1);

  assert.equal(canonicalizeUrl("https://EXAMPLE.test/a/?b=2&utm_medium=email&a=1#top"), "https://example.test/a?a=1&b=2");
  assert.equal(findDuplicate(roleDuplicate, [first]).existingJob.id, first.id);
});

test("persists bounded scan outcomes with profile version and safe error codes", () => {
  const rootPath = mkdtempSync(join(tmpdir(), "career-ops-scan-run-"));
  const outcomes = [
    { outcome: "active", jobId: "greenhouse-a", canonicalUrl: "https://example.test/a", errorCode: null },
    { outcome: "expired", jobId: "greenhouse-b", canonicalUrl: "https://example.test/b", errorCode: "POSTING_EXPIRED" },
    { outcome: "blocked", jobId: null, canonicalUrl: null, errorCode: "ACCESS_DENIED" },
    { outcome: "duplicate", jobId: "greenhouse-a", canonicalUrl: "https://example.test/a", errorCode: "DUPLICATE_CANONICAL_URL" },
    { outcome: "rejected", jobId: "greenhouse-c", canonicalUrl: "https://example.test/c", errorCode: "HARD_FILTER_FAILED" },
    { outcome: "shortlisted", jobId: "greenhouse-d", canonicalUrl: "https://example.test/d", errorCode: null },
  ];
  const run = {
    schemaVersion: 1,
    id: "scan-20260823-01",
    profileVersion: 4,
    trigger: "manual",
    collector: "ats-api",
    sourceId: "acme",
    startedAt: timestamp,
    finishedAt: timestamp,
    status: "partial",
    outcomes,
    counts: countScanOutcomes(outcomes),
    errorCode: "ACCESS_DENIED",
  };
  saveScanRun(run, rootPath);
  assert.deepEqual(loadScanRun(run.id, rootPath), run);
  assert.equal(statSync(join(rootPath, "scan-runs", `${run.id}.json`)).mode & 0o777, 0o600);

  const unsafe = structuredClone(run);
  unsafe.outcomes[0].descriptionText = "Raw job text must never be logged.";
  assert.throws(() => saveScanRun(unsafe, rootPath), ScanRunValidationError);
});
