import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { saveDiscoveredJob } from "../store/discovered-jobs.mjs";
import { enqueueApprovedJob, evaluationQueuePath, loadEvaluationQueue } from "../evaluation/queue.mjs";
import { loadMaterialBundle, materialBundlePath, processNextEvaluation } from "../evaluation/worker.mjs";
const NOW = "2026-08-23T12:00:00.000Z";
function root() { return mkdtempSync(join(tmpdir(), "career-ops-evaluation-")); }
function job(id = "approved-role") { return { schemaVersion: 1, id, canonicalUrl: `https://boards.example.test/jobs/${id}`, externalIds: { fixture: id }, source: { provider: "manual", identifier: "fixture", sourceUrl: "https://boards.example.test" }, role: { company: "Example", title: "Principal Engineer", location: "Remote", workplaceMode: "remote", employmentType: "full-time", industry: "software", salary: null, workAuthorization: "unknown", clearance: "unknown" }, description: { sha256: "a".repeat(64), localPath: `details/${id}.txt` }, postedAt: NOW, discoveredAt: NOW, normalizedAt: NOW, lifecycle: "active" }; }
function profile() { return { profileVersion: 4, evidenceReferences: [{ kind: "resume", localPath: "cv.md", label: "Primary resume", updatedAt: NOW }] }; }
function approval() { return { status: "approved-for-evaluation", approvedBy: "Dee", approvedAt: NOW }; }
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function projectFile(path) { return readFileSync(join(projectRoot, path), "utf8"); }
test("queues only explicitly approved discovered-job IDs and passes bounded context to the evaluator", async () => {
  const dataRoot = root(); saveDiscoveredJob(job(), dataRoot);
  const request = enqueueApprovedJob({ jobId: "approved-role", approval: approval(), profile: profile(), rootPath: dataRoot, now: NOW }); assert.equal(statSync(evaluationQueuePath(dataRoot)).mode & 0o777, 0o600);
  let received; const result = await processNextEvaluation({ rootPath: dataRoot, now: NOW, evaluator: async (context) => { received = context; return { reportPath: "reports/001-example-2026-08-23.md", pdfPath: "output/001-example.pdf", checklistPath: "materials/001-checklist.md" }; } });
  assert.equal(received.requestId, request.id); assert.equal(received.targetProfileVersion, 4); assert.deepEqual(received.normalizedJdSnapshot, { sha256: "a".repeat(64), localPath: "details/approved-role.txt" }); assert.deepEqual(received.evidenceReferences, profile().evidenceReferences); assert.equal(received.draftOnly, true); assert.equal(received.submissionAllowed, false);
  const bundle = loadMaterialBundle(result.bundle.id, dataRoot); assert.equal(bundle.reviewState, "draft-awaiting-review"); assert.equal(bundle.reportPath, "reports/001-example-2026-08-23.md"); assert.equal(statSync(materialBundlePath(bundle.id, dataRoot)).mode & 0o777, 0o600); assert.equal(loadEvaluationQueue(dataRoot).requests[0].status, "succeeded");
});
test("refuses unapproved jobs and any discovery or scheduler enqueue origin", () => {
  const dataRoot = root(); saveDiscoveredJob(job("unapproved-role"), dataRoot);
  assert.throws(() => enqueueApprovedJob({ jobId: "unapproved-role", profile: profile(), rootPath: dataRoot, now: NOW }), /explicit approved-for-evaluation/);
  assert.throws(() => enqueueApprovedJob({ jobId: "unapproved-role", approval: approval(), profile: profile(), rootPath: dataRoot, origin: "discovery", now: NOW }), /forbidden from discovery/);
  assert.throws(() => enqueueApprovedJob({ jobId: "unapproved-role", approval: approval(), profile: profile(), rootPath: dataRoot, origin: "scheduler", now: NOW }), /forbidden from scheduler/);
  assert.equal(loadEvaluationQueue(dataRoot).requests.length, 0);
});
test("material instructions preserve provenance, evidence, and manual-only application handling", () => {
  const checklist = projectFile("agent/templates/application-checklist.md");
  const pipeline = projectFile("modes/auto-pipeline.md");
  const oferta = projectFile("modes/oferta.md");
  for (const content of [checklist, pipeline, oferta]) {
    assert.match(content, /targetProfileVersion|Target Profile version/);
    assert.match(content, /normalizedJdSnapshot|Source snapshot|snapshot del JD/);
    assert.match(content, /evidenceReferences|Evidence reference/);
    assert.match(content, /\[DRAFT\]|DRAFT ONLY/);
  }
  assert.match(checklist, /Unresolved gaps/i);
  assert.match(checklist, /never fills a\n+      page, uploads a file, clicks submit, or submits an application/i);
  assert.match(pipeline, /no navegar a formularios de aplicación/i);
  assert.match(oferta, /No rellenar formularios, subir archivos ni enviar solicitudes/i);
});
