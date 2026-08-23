// Durable, local-only scheduler state.  This intentionally stores operational
// metadata only: no URLs, job titles, browser context IDs, or collector output.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_AUTODISCOVERY_PATH } from "./discovered-jobs.mjs";

export const RUN_QUEUE_SCHEMA_VERSION = 1;
export const MAX_RUN_QUEUE_ENTRIES = 500;
const IDS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CODES = /^[A-Z][A-Z0-9_]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TRIGGERS = new Set(["manual", "scheduled"]);
const STATUSES = new Set(["queued", "running", "succeeded", "partial", "failed", "blocked", "skipped"]);

export class RunQueueValidationError extends Error {
  constructor(errors) {
    super(`Run queue is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "RunQueueValidationError";
    this.errors = errors;
  }
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function timestamp(value) { return typeof value === "string" && ISO.test(value) && !Number.isNaN(Date.parse(value)); }
function safeCode(value) { return value === null || (typeof value === "string" && CODES.test(value)); }

export function emptyRunQueue() {
  return { schemaVersion: RUN_QUEUE_SCHEMA_VERSION, killSwitch: { enabled: false, changedAt: null }, sources: {}, runs: [] };
}

function validateRun(run, path, errors) {
  if (!object(run)) { errors.push(`${path} must be an object`); return; }
  const keys = new Set(["id", "trigger", "sourceId", "profileVersion", "status", "attempt", "scheduledAt", "startedAt", "finishedAt", "lastFailureAt", "nextAttemptAt", "errorCode", "resultCount"]);
  for (const key of Object.keys(run)) if (!keys.has(key)) errors.push(`${path}.${key} is not allowed`);
  if (typeof run.id !== "string" || !IDS.test(run.id)) errors.push(`${path}.id must be a safe identifier`);
  if (!TRIGGERS.has(run.trigger)) errors.push(`${path}.trigger must be manual or scheduled`);
  if (typeof run.sourceId !== "string" || !IDS.test(run.sourceId)) errors.push(`${path}.sourceId must be a safe identifier`);
  if (!Number.isInteger(run.profileVersion) || run.profileVersion < 1) errors.push(`${path}.profileVersion must be positive`);
  if (!STATUSES.has(run.status)) errors.push(`${path}.status is not supported`);
  if (!Number.isInteger(run.attempt) || run.attempt < 1 || run.attempt > 10) errors.push(`${path}.attempt must be from 1 through 10`);
  for (const field of ["scheduledAt", "startedAt", "finishedAt", "lastFailureAt", "nextAttemptAt"]) {
    if (run[field] !== null && !timestamp(run[field])) errors.push(`${path}.${field} must be an ISO timestamp or null`);
  }
  if (!safeCode(run.errorCode)) errors.push(`${path}.errorCode must be a safe code or null`);
  if (!Number.isInteger(run.resultCount) || run.resultCount < 0 || run.resultCount > 500) errors.push(`${path}.resultCount must be from 0 through 500`);
}

export function validateRunQueue(queue) {
  const errors = [];
  if (!object(queue)) return ["queue must be an object"];
  for (const key of Object.keys(queue)) if (!new Set(["schemaVersion", "killSwitch", "sources", "runs"]).has(key)) errors.push(`queue.${key} is not allowed`);
  if (queue.schemaVersion !== RUN_QUEUE_SCHEMA_VERSION) errors.push("queue.schemaVersion must equal 1");
  if (!object(queue.killSwitch) || typeof queue.killSwitch.enabled !== "boolean" || (queue.killSwitch.changedAt !== null && !timestamp(queue.killSwitch.changedAt))) errors.push("queue.killSwitch is invalid");
  if (!object(queue.sources)) errors.push("queue.sources must be an object");
  else for (const [id, source] of Object.entries(queue.sources)) {
    if (!IDS.test(id) || !object(source) || !Number.isInteger(source.failureCount) || source.failureCount < 0 || source.failureCount > 10 || (source.cooldownUntil !== null && !timestamp(source.cooldownUntil))) errors.push(`queue.sources.${id} is invalid`);
  }
  if (!Array.isArray(queue.runs) || queue.runs.length > MAX_RUN_QUEUE_ENTRIES) errors.push(`queue.runs must contain at most ${MAX_RUN_QUEUE_ENTRIES} entries`);
  else queue.runs.forEach((run, index) => validateRun(run, `queue.runs[${index}]`, errors));
  return errors;
}

export function assertValidRunQueue(queue) {
  const errors = validateRunQueue(queue);
  if (errors.length) throw new RunQueueValidationError(errors);
  return queue;
}

export function runQueuePath(rootPath = DEFAULT_AUTODISCOVERY_PATH) { return join(resolve(rootPath), "run-queue.json"); }
export function runLockPath(rootPath = DEFAULT_AUTODISCOVERY_PATH) { return join(resolve(rootPath), "scheduler.lock"); }

export function loadRunQueue(rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const path = runQueuePath(rootPath);
  return existsSync(path) ? assertValidRunQueue(JSON.parse(readFileSync(path, "utf8"))) : emptyRunQueue();
}

export function saveRunQueue(queue, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const value = assertValidRunQueue(structuredClone(queue));
  const path = runQueuePath(rootPath);
  mkdirSync(resolve(rootPath), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return structuredClone(value);
}

export function setKillSwitch(enabled, { rootPath = DEFAULT_AUTODISCOVERY_PATH, now = new Date() } = {}) {
  const queue = loadRunQueue(rootPath);
  queue.killSwitch = { enabled: Boolean(enabled), changedAt: now.toISOString() };
  return saveRunQueue(queue, rootPath);
}

export function createQueuedRun({ id = `run-${randomUUID()}`, trigger, sourceId, profileVersion, scheduledAt }) {
  const run = { id, trigger, sourceId, profileVersion, status: "queued", attempt: 1, scheduledAt, startedAt: null, finishedAt: null, lastFailureAt: null, nextAttemptAt: null, errorCode: null, resultCount: 0 };
  validateRun(run, "run", []);
  return run;
}

export function trimCompletedRuns(queue) {
  const pending = queue.runs.filter((run) => run.status === "queued" || run.status === "running");
  const complete = queue.runs.filter((run) => run.status !== "queued" && run.status !== "running").slice(-(MAX_RUN_QUEUE_ENTRIES - pending.length));
  queue.runs = [...pending, ...complete];
  return queue;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

/** Acquire a non-waiting, cross-process scheduler lock. */
export function acquireRunLock(rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const path = runLockPath(rootPath);
  mkdirSync(resolve(rootPath), { recursive: true });
  try {
    mkdirSync(path);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
      if (processAlive(owner?.pid)) return null;
    } catch { return null; }
    // A dead process left the lock behind. The directory is only reclaimed
    // after proving its recorded owner is not alive.
    try { rmSync(path, { recursive: true, force: true }); mkdirSync(path); } catch { return null; }
  }
  const token = randomUUID();
  try { writeFileSync(join(path, "owner.json"), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 }); }
  catch (error) { try { rmSync(path, { recursive: true, force: true }); } catch {} throw error; }
  return { release() {
    try {
      const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
      if (owner?.token === token) rmSync(path, { recursive: true, force: true });
    } catch { /* A replacement owner must never be removed. */ }
  } };
}
