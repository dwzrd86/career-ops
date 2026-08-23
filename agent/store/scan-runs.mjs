import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_AUTODISCOVERY_PATH } from "./discovered-jobs.mjs";

export const SCAN_RUN_SCHEMA_VERSION = 1;

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const outcomes = new Set(["active", "expired", "blocked", "duplicate", "rejected", "shortlisted"]);
const statuses = new Set(["succeeded", "partial", "failed", "blocked"]);
const collectors = new Set(["ats-api", "interceptor", "mixed"]);
const triggers = new Set(["manual", "scheduled"]);
const rawContentKeys = new Set(["rawResume", "resumeText", "resumeContent", "rawDescription", "descriptionText", "jobDescription", "jdText", "rawContent"]);

export class ScanRunValidationError extends Error {
  constructor(errors) {
    super(`Scan Run is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "ScanRunValidationError";
    this.errors = errors;
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function rejectRawContent(value, path, errors) {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectRawContent(entry, `${path}[${index}]`, errors));
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (rawContentKeys.has(key)) errors.push(`${path}.${key} must not contain raw resume or job-description content`);
    rejectRawContent(child, `${path}.${key}`, errors);
  }
}

function requireKnownKeys(value, keys, path, errors) {
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${path}.${key} is not allowed`);
}

export function validateScanRun(run) {
  const errors = [];
  if (!object(run)) return ["run must be an object"];
  rejectRawContent(run, "run", errors);
  requireKnownKeys(run, new Set(["schemaVersion", "id", "profileVersion", "trigger", "collector", "sourceId", "startedAt", "finishedAt", "status", "outcomes", "counts", "errorCode"]), "run", errors);
  if (run.schemaVersion !== SCAN_RUN_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${SCAN_RUN_SCHEMA_VERSION}`);
  if (typeof run.id !== "string" || !RECORD_ID_PATTERN.test(run.id)) errors.push("id must be a safe record identifier");
  if (!Number.isInteger(run.profileVersion) || run.profileVersion < 1) errors.push("profileVersion must be a positive integer");
  if (!triggers.has(run.trigger)) errors.push("trigger must be manual or scheduled");
  if (!collectors.has(run.collector)) errors.push("collector must be ats-api, interceptor, or mixed");
  if (typeof run.sourceId !== "string" || run.sourceId.trim() === "") errors.push("sourceId must be a non-empty string");
  if (!validTimestamp(run.startedAt) || !validTimestamp(run.finishedAt)) errors.push("startedAt and finishedAt must be ISO timestamps");
  if (validTimestamp(run.startedAt) && validTimestamp(run.finishedAt) && Date.parse(run.finishedAt) < Date.parse(run.startedAt)) errors.push("finishedAt must not be before startedAt");
  if (!statuses.has(run.status)) errors.push("status must be succeeded, partial, failed, or blocked");
  if (!Array.isArray(run.outcomes)) {
    errors.push("outcomes must be an array");
  } else {
    run.outcomes.forEach((entry, index) => {
      const path = `outcomes[${index}]`;
      if (!object(entry)) return errors.push(`${path} must be an object`);
      requireKnownKeys(entry, new Set(["outcome", "jobId", "canonicalUrl", "errorCode"]), path, errors);
      if (!outcomes.has(entry.outcome)) errors.push(`${path}.outcome must be a supported scan outcome`);
      if (entry.jobId !== null && (typeof entry.jobId !== "string" || !RECORD_ID_PATTERN.test(entry.jobId))) errors.push(`${path}.jobId must be a safe identifier or null`);
      if (entry.canonicalUrl !== null && (typeof entry.canonicalUrl !== "string" || !/^https?:\/\/\S+$/i.test(entry.canonicalUrl))) errors.push(`${path}.canonicalUrl must be an HTTP(S) URL or null`);
      if (entry.errorCode !== null && (typeof entry.errorCode !== "string" || !SAFE_CODE_PATTERN.test(entry.errorCode))) errors.push(`${path}.errorCode must be a stable safe code or null`);
    });
  }
  if (!object(run.counts)) {
    errors.push("counts must be an object");
  } else {
    requireKnownKeys(run.counts, outcomes, "counts", errors);
    for (const outcome of outcomes) if (!Number.isInteger(run.counts[outcome]) || run.counts[outcome] < 0) errors.push(`counts.${outcome} must be a non-negative integer`);
    if (Array.isArray(run.outcomes)) {
      const expectedCounts = countScanOutcomes(run.outcomes);
      for (const outcome of outcomes) if (run.counts[outcome] !== expectedCounts[outcome]) errors.push(`counts.${outcome} must match recorded outcomes`);
    }
  }
  if (run.errorCode !== null && (typeof run.errorCode !== "string" || !SAFE_CODE_PATTERN.test(run.errorCode))) errors.push("errorCode must be a stable safe code or null");
  return errors;
}

export function assertValidScanRun(run) {
  const errors = validateScanRun(run);
  if (errors.length > 0) throw new ScanRunValidationError(errors);
  return run;
}

export function scanRunPath(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  if (typeof id !== "string" || !RECORD_ID_PATTERN.test(id)) throw new Error("scan run id must be a safe record identifier");
  return join(resolve(rootPath), "scan-runs", `${id}.json`);
}

export function saveScanRun(run, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const saved = assertValidScanRun(structuredClone(run));
  const path = scanRunPath(saved.id, rootPath);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  return structuredClone(saved);
}

export function loadScanRun(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  const path = scanRunPath(id, rootPath);
  if (!existsSync(path)) return null;
  return assertValidScanRun(JSON.parse(readFileSync(path, "utf8")));
}

export function countScanOutcomes(entries) {
  const counts = Object.fromEntries([...outcomes].map((outcome) => [outcome, 0]));
  for (const entry of entries) if (outcomes.has(entry.outcome)) counts[entry.outcome] += 1;
  return counts;
}
