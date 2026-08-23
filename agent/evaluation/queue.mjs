// Local evaluation queue. Discovery and scheduler modules must never enqueue
// work here: a reviewer supplies a separate, explicit approval record.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_AUTODISCOVERY_PATH, assertValidDiscoveredJob, loadDiscoveredJob } from "../store/discovered-jobs.mjs";

export const EVALUATION_QUEUE_SCHEMA_VERSION = 1;
export const DEFAULT_EVALUATION_ORIGIN = "manual-review";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_REQUESTS = 200;
const BLOCKED_ORIGINS = new Set(["collector", "discovery", "scheduler", "browser", "projection"]);
const REQUEST_STATES = new Set(["queued", "running", "succeeded", "failed"]);

export class EvaluationQueueValidationError extends Error {
  constructor(errors) { super(`Evaluation queue is invalid:\n- ${errors.join("\n- ")}`); this.name = "EvaluationQueueValidationError"; this.errors = errors; }
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function timestamp(value) { return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)); }
function safeId(value) { return typeof value === "string" && SAFE_ID.test(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim() !== ""; }
function relativePath(value) { return nonEmpty(value) && !value.includes("\0") && !value.startsWith("/") && !value.split(/[\\/]+/).includes(".."); }

function validateEvidenceReferences(references, path, errors) {
  if (!Array.isArray(references)) { errors.push(`${path} must be an array`); return; }
  references.forEach((reference, index) => {
    const prefix = `${path}[${index}]`;
    if (!object(reference)) { errors.push(`${prefix} must be an object`); return; }
    if (!nonEmpty(reference.kind) || !nonEmpty(reference.localPath) || !nonEmpty(reference.label)) errors.push(`${prefix} must contain kind, localPath, and label`);
    if (reference.updatedAt !== null && !timestamp(reference.updatedAt)) errors.push(`${prefix}.updatedAt must be an ISO timestamp or null`);
  });
}

function validateRequest(request, path, errors) {
  if (!object(request)) { errors.push(`${path} must be an object`); return; }
  const allowed = new Set(["id", "jobId", "approval", "requestedAt", "requestedBy", "status", "attempt", "startedAt", "finishedAt", "errorCode", "workItem"]);
  for (const key of Object.keys(request)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  if (!safeId(request.id) || !safeId(request.jobId)) errors.push(`${path} must have safe id and jobId`);
  if (!timestamp(request.requestedAt) || !nonEmpty(request.requestedBy)) errors.push(`${path} must have requestedAt and requestedBy`);
  if (!REQUEST_STATES.has(request.status) || !Number.isInteger(request.attempt) || request.attempt < 0) errors.push(`${path} has invalid status or attempt`);
  if (request.startedAt !== null && !timestamp(request.startedAt)) errors.push(`${path}.startedAt must be an ISO timestamp or null`);
  if (request.finishedAt !== null && !timestamp(request.finishedAt)) errors.push(`${path}.finishedAt must be an ISO timestamp or null`);
  if (request.errorCode !== null && !nonEmpty(request.errorCode)) errors.push(`${path}.errorCode must be a non-empty string or null`);
  if (!object(request.approval) || request.approval.status !== "approved-for-evaluation" || !nonEmpty(request.approval.approvedBy) || !timestamp(request.approval.approvedAt)) errors.push(`${path}.approval must be an explicit approved-for-evaluation record`);
  if (!object(request.workItem)) { errors.push(`${path}.workItem must be an object`); return; }
  const workItem = request.workItem;
  if (!Number.isInteger(workItem.targetProfileVersion) || workItem.targetProfileVersion < 1) errors.push(`${path}.workItem.targetProfileVersion must be a positive integer`);
  try { assertValidDiscoveredJob(workItem.job); } catch { errors.push(`${path}.workItem.job must be a valid normalized discovered job`); }
  if (!object(workItem.normalizedJdSnapshot) || !relativePath(workItem.normalizedJdSnapshot.localPath) || (workItem.normalizedJdSnapshot.sha256 !== null && !/^[a-f0-9]{64}$/.test(workItem.normalizedJdSnapshot.sha256))) errors.push(`${path}.workItem.normalizedJdSnapshot must contain a local relative path and SHA-256 or null`);
  validateEvidenceReferences(workItem.evidenceReferences, `${path}.workItem.evidenceReferences`, errors);
}

export function emptyEvaluationQueue() { return { schemaVersion: EVALUATION_QUEUE_SCHEMA_VERSION, requests: [] }; }
export function validateEvaluationQueue(queue) {
  const errors = [];
  if (!object(queue)) return ["queue must be an object"];
  for (const key of Object.keys(queue)) if (!["schemaVersion", "requests"].includes(key)) errors.push(`queue.${key} is not allowed`);
  if (queue.schemaVersion !== EVALUATION_QUEUE_SCHEMA_VERSION) errors.push("queue.schemaVersion must equal 1");
  if (!Array.isArray(queue.requests) || queue.requests.length > MAX_REQUESTS) errors.push(`queue.requests must contain at most ${MAX_REQUESTS} requests`);
  else queue.requests.forEach((request, index) => validateRequest(request, `queue.requests[${index}]`, errors));
  return errors;
}
export function assertValidEvaluationQueue(queue) {
  const errors = validateEvaluationQueue(queue);
  if (errors.length > 0) throw new EvaluationQueueValidationError(errors);
  return queue;
}
export function evaluationQueuePath(rootPath = DEFAULT_AUTODISCOVERY_PATH) { return join(resolve(rootPath), "evaluation", "queue.json"); }
function writePrivate(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return structuredClone(value);
}
export function loadEvaluationQueue(rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const path = evaluationQueuePath(rootPath);
  if (!existsSync(path)) return emptyEvaluationQueue();
  return assertValidEvaluationQueue(JSON.parse(readFileSync(path, "utf8")));
}
export function saveEvaluationQueue(queue, rootPath = DEFAULT_AUTODISCOVERY_PATH) { return writePrivate(evaluationQueuePath(rootPath), assertValidEvaluationQueue(structuredClone(queue))); }
function explicitApproval(approval) { return object(approval) && approval.status === "approved-for-evaluation" && nonEmpty(approval.approvedBy) && timestamp(approval.approvedAt); }

/** Queue a reviewed job; scheduler, collector, browser, and discovery callbacks are refused. */
export function enqueueApprovedJob({ jobId, approval, profile, rootPath = DEFAULT_AUTODISCOVERY_PATH, origin = DEFAULT_EVALUATION_ORIGIN, requestedBy = approval?.approvedBy, now = new Date() } = {}) {
  if (BLOCKED_ORIGINS.has(origin)) throw new Error(`Evaluation enqueue is forbidden from ${origin} events.`);
  if (origin !== DEFAULT_EVALUATION_ORIGIN) throw new Error("Evaluation enqueue requires the manual-review origin.");
  if (!safeId(jobId)) throw new Error("jobId must be a safe discovered-job ID.");
  if (!explicitApproval(approval)) throw new Error("An explicit approved-for-evaluation approval record is required.");
  if (!object(profile) || !Number.isInteger(profile.profileVersion) || profile.profileVersion < 1 || !Array.isArray(profile.evidenceReferences)) throw new Error("A saved Target Profile version and evidenceReferences are required.");
  const evidenceErrors = []; validateEvidenceReferences(profile.evidenceReferences, "evidenceReferences", evidenceErrors);
  if (evidenceErrors.length > 0) throw new Error(`Target Profile evidenceReferences are invalid: ${evidenceErrors.join(", ")}`);
  const requestedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  if (!timestamp(requestedAt)) throw new Error("now must be a valid date.");
  const job = loadDiscoveredJob(jobId, rootPath);
  if (job === null) throw new Error(`Local discovered job not found: ${jobId}`);
  const queue = loadEvaluationQueue(rootPath);
  if (queue.requests.some((request) => request.jobId === jobId && ["queued", "running"].includes(request.status))) throw new Error(`Job ${jobId} already has pending evaluation work.`);
  const request = { id: `eval-${randomUUID()}`, jobId, approval: { status: approval.status, approvedBy: approval.approvedBy.trim(), approvedAt: approval.approvedAt }, requestedAt, requestedBy: String(requestedBy ?? "").trim(), status: "queued", attempt: 0, startedAt: null, finishedAt: null, errorCode: null, workItem: { targetProfileVersion: profile.profileVersion, job: structuredClone(job), normalizedJdSnapshot: { sha256: job.description.sha256, localPath: job.description.localPath }, evidenceReferences: structuredClone(profile.evidenceReferences) } };
  if (!request.requestedBy) throw new Error("requestedBy is required.");
  queue.requests.push(request); saveEvaluationQueue(queue, rootPath); return structuredClone(request);
}
export function claimNextEvaluation(rootPath = DEFAULT_AUTODISCOVERY_PATH, now = new Date()) {
  const queue = loadEvaluationQueue(rootPath); const request = queue.requests.find((entry) => entry.status === "queued");
  if (!request) return null;
  request.status = "running"; request.attempt += 1; request.startedAt = (now instanceof Date ? now : new Date(now)).toISOString(); request.finishedAt = null; request.errorCode = null;
  saveEvaluationQueue(queue, rootPath); return structuredClone(request);
}
export function finishEvaluationRequest(id, { status, errorCode = null, now = new Date() } = {}, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  if (!safeId(id)) throw new Error("id must be a safe evaluation request ID.");
  if (!["succeeded", "failed"].includes(status)) throw new Error("Evaluation request status must be succeeded or failed.");
  const queue = loadEvaluationQueue(rootPath); const request = queue.requests.find((entry) => entry.id === id);
  if (!request || request.status !== "running") throw new Error(`No running evaluation request found: ${id}`);
  request.status = status; request.finishedAt = (now instanceof Date ? now : new Date(now)).toISOString(); request.errorCode = status === "failed" ? (nonEmpty(errorCode) ? errorCode : "EVALUATION_FAILED") : null;
  saveEvaluationQueue(queue, rootPath); return structuredClone(request);
}
