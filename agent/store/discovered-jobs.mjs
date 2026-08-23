import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DISCOVERED_JOB_SCHEMA_VERSION = 1;
export const MATCH_DECISION_SCHEMA_VERSION = 1;
export const DEFAULT_AUTODISCOVERY_PATH = resolve("data/autodiscovery");

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const providers = new Set(["greenhouse", "ashby", "lever", "interceptor", "manual"]);
const workplaceModes = new Set(["remote", "hybrid", "onsite", "unknown"]);
const knowledgeStates = new Set(["required", "not-required", "unknown"]);
const lifecycles = new Set(["active", "expired", "unknown", "archived"]);
const decisionOutcomes = new Set(["rejected", "ranked", "needs-review"]);
const filterOutcomes = new Set(["pass", "fail", "unknown", "not-applicable"]);
const prohibitedContentKeys = new Set(["rawResume", "resumeText", "resumeContent", "rawDescription", "descriptionText", "jobDescription", "jdText", "rawContent"]);

export class DiscoveredJobValidationError extends Error {
  constructor(errors) {
    super(`Discovered Job is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "DiscoveredJobValidationError";
    this.errors = errors;
  }
}

export class MatchDecisionValidationError extends Error {
  constructor(errors) {
    super(`Match Decision is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "MatchDecisionValidationError";
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, path, errors) {
  if (!isPlainObject(value)) errors.push(`${path} must be an object`);
  return isPlainObject(value);
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function requireString(value, path, errors, { pattern, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string${nullable ? " or null" : ""}`);
  } else if (pattern && !pattern.test(value)) {
    errors.push(`${path} has an invalid format`);
  }
}

function requireTimestamp(value, path, errors, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO timestamp${nullable ? " or null" : ""}`);
  }
}

function requireScore(value, path, errors, { nullable = true } = {}) {
  if (nullable && value === null) return;
  if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`${path} must be a number from 0 through 100${nullable ? " or null" : ""}`);
}

function rejectRawContent(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectRawContent(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (prohibitedContentKeys.has(key)) errors.push(`${path}.${key} must not contain raw resume or job-description content`);
    rejectRawContent(child, `${path}.${key}`, errors);
  }
}

function validateRecordId(value, path, errors) {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) errors.push(`${path} must be a safe record identifier`);
}

function validateExternalIds(value, errors) {
  if (!requireObject(value, "externalIds", errors)) return;
  for (const [provider, identifier] of Object.entries(value)) {
    requireString(provider, "externalIds key", errors);
    requireString(identifier, `externalIds.${provider}`, errors);
  }
}

function validateSalary(value, errors) {
  if (value === null) return;
  if (!requireObject(value, "role.salary", errors)) return;
  rejectUnknownKeys(value, new Set(["minimum", "maximum", "currency", "basis"]), "role.salary", errors);
  for (const field of ["minimum", "maximum"]) {
    if (value[field] !== null && (!Number.isFinite(value[field]) || value[field] < 0)) errors.push(`role.salary.${field} must be a non-negative number or null`);
  }
  if (Number.isFinite(value.minimum) && Number.isFinite(value.maximum) && value.maximum < value.minimum) errors.push("role.salary.maximum must not be lower than role.salary.minimum");
  requireString(value.currency, "role.salary.currency", errors, { pattern: /^[A-Z]{3}$/ });
  if (!new Set(["annual", "hourly", "unknown"]).has(value.basis)) errors.push("role.salary.basis must be annual, hourly, or unknown");
}

function validateRole(value, errors) {
  if (!requireObject(value, "role", errors)) return;
  rejectUnknownKeys(value, new Set(["company", "title", "location", "workplaceMode", "employmentType", "industry", "salary", "workAuthorization", "clearance"]), "role", errors);
  requireString(value.company, "role.company", errors);
  requireString(value.title, "role.title", errors);
  requireString(value.location, "role.location", errors, { nullable: true });
  if (!workplaceModes.has(value.workplaceMode)) errors.push("role.workplaceMode must be remote, hybrid, onsite, or unknown");
  requireString(value.employmentType, "role.employmentType", errors, { nullable: true });
  requireString(value.industry, "role.industry", errors, { nullable: true });
  validateSalary(value.salary, errors);
  if (!knowledgeStates.has(value.workAuthorization)) errors.push("role.workAuthorization must be required, not-required, or unknown");
  if (!knowledgeStates.has(value.clearance)) errors.push("role.clearance must be required, not-required, or unknown");
}

function validateDescriptionReference(value, errors) {
  if (!requireObject(value, "description", errors)) return;
  rejectUnknownKeys(value, new Set(["sha256", "localPath"]), "description", errors);
  if (value.sha256 !== null && (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))) errors.push("description.sha256 must be a lowercase SHA-256 hash or null");
  requireString(value.localPath, "description.localPath", errors, { nullable: true });
}

export function validateDiscoveredJob(job) {
  const errors = [];
  if (!isPlainObject(job)) return ["job must be an object"];
  rejectRawContent(job, "job", errors);
  rejectUnknownKeys(job, new Set(["schemaVersion", "id", "canonicalUrl", "externalIds", "source", "role", "description", "postedAt", "discoveredAt", "normalizedAt", "lifecycle"]), "job", errors);
  if (job.schemaVersion !== DISCOVERED_JOB_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${DISCOVERED_JOB_SCHEMA_VERSION}`);
  validateRecordId(job.id, "id", errors);
  requireString(job.canonicalUrl, "canonicalUrl", errors, { pattern: URL_PATTERN });
  validateExternalIds(job.externalIds, errors);

  if (requireObject(job.source, "source", errors)) {
    rejectUnknownKeys(job.source, new Set(["provider", "identifier", "sourceUrl"]), "source", errors);
    if (!providers.has(job.source.provider)) errors.push("source.provider must be greenhouse, ashby, lever, interceptor, or manual");
    requireString(job.source.identifier, "source.identifier", errors);
    requireString(job.source.sourceUrl, "source.sourceUrl", errors, { pattern: URL_PATTERN });
  }

  validateRole(job.role, errors);
  validateDescriptionReference(job.description, errors);
  requireTimestamp(job.postedAt, "postedAt", errors, { nullable: true });
  requireTimestamp(job.discoveredAt, "discoveredAt", errors);
  requireTimestamp(job.normalizedAt, "normalizedAt", errors);
  if (!lifecycles.has(job.lifecycle)) errors.push("lifecycle must be active, expired, unknown, or archived");
  return errors;
}

export function assertValidDiscoveredJob(job) {
  const errors = validateDiscoveredJob(job);
  if (errors.length > 0) throw new DiscoveredJobValidationError(errors);
  return job;
}

function validateHardFilterResults(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("hardFilterResults must be an array");
    return;
  }
  value.forEach((result, index) => {
    const path = `hardFilterResults[${index}]`;
    if (!requireObject(result, path, errors)) return;
    rejectUnknownKeys(result, new Set(["ruleId", "outcome", "reasonCode"]), path, errors);
    requireString(result.ruleId, `${path}.ruleId`, errors);
    if (!filterOutcomes.has(result.outcome)) errors.push(`${path}.outcome must be pass, fail, unknown, or not-applicable`);
    requireString(result.reasonCode, `${path}.reasonCode`, errors, { pattern: REASON_CODE_PATTERN });
  });
}

function validateSubscores(value, errors) {
  if (!requireObject(value, "subscores", errors)) return;
  const fields = ["role", "seniority", "framework", "cloudPlatform", "expertise", "preference"];
  rejectUnknownKeys(value, new Set(fields), "subscores", errors);
  for (const field of fields) requireScore(value[field], `subscores.${field}`, errors);
}

function validateReviewerOverride(value, errors) {
  if (value === null) return;
  if (!requireObject(value, "reviewerOverride", errors)) return;
  rejectUnknownKeys(value, new Set(["outcome", "reasonCode", "reviewerId", "overriddenAt"]), "reviewerOverride", errors);
  if (!decisionOutcomes.has(value.outcome)) errors.push("reviewerOverride.outcome must be rejected, ranked, or needs-review");
  requireString(value.reasonCode, "reviewerOverride.reasonCode", errors, { pattern: REASON_CODE_PATTERN });
  requireString(value.reviewerId, "reviewerOverride.reviewerId", errors);
  requireTimestamp(value.overriddenAt, "reviewerOverride.overriddenAt", errors);
}

export function validateMatchDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return ["decision must be an object"];
  rejectRawContent(decision, "decision", errors);
  rejectUnknownKeys(decision, new Set(["schemaVersion", "id", "jobId", "canonicalUrl", "profileVersion", "decidedAt", "outcome", "hardFilterResults", "score", "subscores", "explanationCodes", "reviewerOverride"]), "decision", errors);
  if (decision.schemaVersion !== MATCH_DECISION_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${MATCH_DECISION_SCHEMA_VERSION}`);
  validateRecordId(decision.id, "id", errors);
  validateRecordId(decision.jobId, "jobId", errors);
  requireString(decision.canonicalUrl, "canonicalUrl", errors, { pattern: URL_PATTERN });
  if (!Number.isInteger(decision.profileVersion) || decision.profileVersion < 1) errors.push("profileVersion must be a positive integer");
  requireTimestamp(decision.decidedAt, "decidedAt", errors);
  if (!decisionOutcomes.has(decision.outcome)) errors.push("outcome must be rejected, ranked, or needs-review");
  validateHardFilterResults(decision.hardFilterResults, errors);
  requireScore(decision.score, "score", errors);
  validateSubscores(decision.subscores, errors);
  if (!Array.isArray(decision.explanationCodes) || decision.explanationCodes.some((code) => typeof code !== "string" || !REASON_CODE_PATTERN.test(code))) errors.push("explanationCodes must be an array of stable uppercase reason codes");
  validateReviewerOverride(decision.reviewerOverride, errors);
  return errors;
}

export function assertValidMatchDecision(decision) {
  const errors = validateMatchDecision(decision);
  if (errors.length > 0) throw new MatchDecisionValidationError(errors);
  return decision;
}

function recordPath(rootPath, directory, id) {
  validateRecordId(id, "id", []);
  if (!RECORD_ID_PATTERN.test(id)) throw new Error("record id must be a safe record identifier");
  return join(resolve(rootPath), directory, `${id}.json`);
}

function saveRecord(record, path) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  return structuredClone(record);
}

function loadRecord(path, assertValid) {
  if (!existsSync(path)) return null;
  return assertValid(JSON.parse(readFileSync(path, "utf8")));
}

export function discoveredJobPath(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return recordPath(rootPath, "jobs", id);
}

export function matchDecisionPath(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return recordPath(rootPath, "decisions", id);
}

export function saveDiscoveredJob(job, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return saveRecord(assertValidDiscoveredJob(structuredClone(job)), discoveredJobPath(job.id, rootPath));
}

export function loadDiscoveredJob(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return loadRecord(discoveredJobPath(id, rootPath), assertValidDiscoveredJob);
}

export function saveMatchDecision(decision, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return saveRecord(assertValidMatchDecision(structuredClone(decision)), matchDecisionPath(decision.id, rootPath));
}

export function loadMatchDecision(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) {
  return loadRecord(matchDecisionPath(id, rootPath), assertValidMatchDecision);
}
