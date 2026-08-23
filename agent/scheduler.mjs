// Deterministic scheduler core. Collectors are injected and can only return
// counts/status codes, so scheduled work cannot leak career content or invoke
// evaluation/material generation.
import { randomUUID } from "node:crypto";
import { acquireRunLock, createQueuedRun, loadRunQueue, saveRunQueue, trimCompletedRuns } from "./store/run-queue.mjs";

const TERMINAL = new Set(["succeeded", "partial", "failed", "blocked"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]+$/;
export const DEFAULT_SCHEDULER_OPTIONS = Object.freeze({ maxSourceConcurrency: 2, maxRetries: 2, retryBaseMs: 60_000, cooldownMs: 15 * 60_000, maxJitterMs: 5 * 60_000 });

function iso(clock) { return clock().toISOString(); }
function safeCode(value, fallback) { return typeof value === "string" && SAFE_CODE.test(value) ? value : fallback; }
function timeAt(clock, ms) { return new Date(clock().valueOf() + ms).toISOString(); }
function retryDelay(attempt, options) { return Math.min(options.retryBaseMs * (2 ** Math.max(0, attempt - 1)), 60 * 60_000); }

export function jitterDelay(options = {}, random = Math.random) {
  const max = Math.max(0, Math.floor(options.maxJitterMs ?? DEFAULT_SCHEDULER_OPTIONS.maxJitterMs));
  return max === 0 ? 0 : Math.floor(Math.min(0.999999999, Math.max(0, random())) * (max + 1));
}

export function queueCollectionRun(profile, { trigger = "manual", rootPath, clock = () => new Date(), random = Math.random, options = {} } = {}) {
  const queue = loadRunQueue(rootPath);
  if (queue.killSwitch.enabled) return { queued: [], reason: "KILL_SWITCH_ENABLED" };
  if (!profile?.discovery?.enabled) return { queued: [], reason: "SCHEDULER_DISABLED" };
  const delay = trigger === "scheduled" ? jitterDelay({ ...DEFAULT_SCHEDULER_OPTIONS, ...options }, random) : 0;
  const scheduledAt = timeAt(clock, delay);
  const queued = [...new Set(profile.discovery.sources)].map((sourceId) => createQueuedRun({
    id: `run-${randomUUID()}`, trigger, sourceId, profileVersion: profile.profileVersion, scheduledAt,
  }));
  queue.runs.push(...queued);
  saveRunQueue(trimCompletedRuns(queue), rootPath);
  return { queued: structuredClone(queued), reason: null };
}

async function mapLimit(entries, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < entries.length) { const item = entries[index++]; results.push(await fn(item)); }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), entries.length) }, worker));
  return results;
}

function due(run, now) { return run.status === "queued" && Date.parse(run.scheduledAt) <= now.valueOf(); }
function sourceState(queue, sourceId) { return queue.sources[sourceId] ?? { failureCount: 0, cooldownUntil: null }; }

function finalizeFailure(queue, run, now, options, errorCode) {
  const source = sourceState(queue, run.sourceId);
  source.failureCount += 1;
  run.lastFailureAt = now.toISOString();
  run.errorCode = errorCode;
  run.resultCount = 0;
  if (run.attempt <= options.maxRetries) {
    const delay = retryDelay(run.attempt, options);
    run.attempt += 1;
    run.status = "queued";
    run.scheduledAt = new Date(now.valueOf() + delay).toISOString();
    run.nextAttemptAt = run.scheduledAt;
    run.startedAt = null;
    run.finishedAt = null;
  } else {
    run.status = "failed";
    run.finishedAt = now.toISOString();
    run.nextAttemptAt = null;
    source.cooldownUntil = new Date(now.valueOf() + options.cooldownMs).toISOString();
  }
  queue.sources[run.sourceId] = source;
}

async function runOne(queue, run, { collectors, profile, clock, options }) {
  const now = clock();
  const source = sourceState(queue, run.sourceId);
  if (source.cooldownUntil && Date.parse(source.cooldownUntil) > now.valueOf()) {
    Object.assign(run, { status: "skipped", startedAt: now.toISOString(), finishedAt: now.toISOString(), nextAttemptAt: null, errorCode: "COOLDOWN_ACTIVE", resultCount: 0 });
    return run;
  }
  const collector = collectors?.[run.sourceId];
  if (typeof collector !== "function") { finalizeFailure(queue, run, now, options, "COLLECTOR_UNAVAILABLE"); return run; }
  run.status = "running";
  run.startedAt = now.toISOString();
  let result;
  try { result = await collector(Object.freeze({ sourceId: run.sourceId, trigger: run.trigger, attempt: run.attempt, maxResults: profile.discovery.maxPerRun, profileVersion: profile.profileVersion })); }
  catch { finalizeFailure(queue, run, clock(), options, "COLLECTOR_FAILED"); return run; }
  const status = result?.status;
  if (!TERMINAL.has(status)) { finalizeFailure(queue, run, clock(), options, "COLLECTOR_INVALID_RESULT"); return run; }
  const finished = clock().toISOString();
  const count = Number.isInteger(result?.resultCount) ? Math.min(Math.max(0, result.resultCount), profile.discovery.maxPerRun) : 0;
  if (status === "failed") { finalizeFailure(queue, run, clock(), options, safeCode(result?.errorCode, "COLLECTOR_FAILED")); return run; }
  Object.assign(run, { status, finishedAt: finished, nextAttemptAt: null, errorCode: status === "succeeded" ? null : safeCode(result?.errorCode, status === "blocked" ? "COLLECTOR_BLOCKED" : "COLLECTOR_PARTIAL"), resultCount: count });
  if (status === "succeeded" || status === "partial") queue.sources[run.sourceId] = { failureCount: 0, cooldownUntil: null };
  return run;
}

/** Execute all due source runs once. A second process returns `busy`; it never waits. */
export async function runDueCollections(profile, { collectors = {}, rootPath, clock = () => new Date(), options = {} } = {}) {
  const merged = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
  const lock = acquireRunLock(rootPath);
  if (!lock) return { status: "busy", runs: [] };
  try {
    const queue = loadRunQueue(rootPath);
    if (queue.killSwitch.enabled) return { status: "killed", runs: [] };
    if (!profile?.discovery?.enabled) return { status: "disabled", runs: [] };
    const dueRuns = queue.runs.filter((run) => due(run, clock()));
    const runs = await mapLimit(dueRuns, merged.maxSourceConcurrency, async (run) => runOne(queue, run, { collectors, profile, clock, options: merged }));
    saveRunQueue(trimCompletedRuns(queue), rootPath);
    return { status: "ok", runs: structuredClone(runs) };
  } finally { lock.release(); }
}

export async function requestCollectionRun(profile, settings = {}) {
  const queued = queueCollectionRun(profile, settings);
  if (queued.reason) return { status: queued.reason === "KILL_SWITCH_ENABLED" ? "killed" : "disabled", runs: [] };
  return runDueCollections(profile, settings);
}
