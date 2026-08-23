// Explicit adapter boundary to the established evaluator/report/PDF flow. This
// module has no collector, scheduler, browser, network, or submission ability.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_AUTODISCOVERY_PATH } from "../store/discovered-jobs.mjs";
import { claimNextEvaluation, finishEvaluationRequest } from "./queue.mjs";

export const MATERIAL_BUNDLE_SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const REVIEW_STATES = new Set(["draft-awaiting-review", "approved", "changes-requested", "rejected"]);
export class MaterialBundleValidationError extends Error { constructor(errors) { super(`Material bundle is invalid:\n- ${errors.join("\n- ")}`); this.name = "MaterialBundleValidationError"; this.errors = errors; } }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function timestamp(value) { return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)); }
function relativePath(value) { return typeof value === "string" && value.trim() !== "" && !value.includes("\0") && !value.startsWith("/") && !value.split(/[\\/]+/).includes(".."); }
function references(value, path, errors) { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; } value.forEach((reference, index) => { if (!object(reference) || typeof reference.kind !== "string" || typeof reference.localPath !== "string" || typeof reference.label !== "string") errors.push(`${path}[${index}] must be evidence-reference metadata`); }); }
export function validateMaterialBundle(bundle) {
  const errors = []; if (!object(bundle)) return ["bundle must be an object"];
  const allowed = new Set(["schemaVersion", "id", "requestId", "jobId", "targetProfileVersion", "normalizedJdSnapshot", "evidenceReferences", "reportPath", "pdfPath", "checklistPath", "reviewState", "createdAt"]);
  for (const key of Object.keys(bundle)) if (!allowed.has(key)) errors.push(`bundle.${key} is not allowed`);
  if (bundle.schemaVersion !== MATERIAL_BUNDLE_SCHEMA_VERSION) errors.push("bundle.schemaVersion must equal 1");
  for (const key of ["id", "requestId", "jobId"]) if (typeof bundle[key] !== "string" || !SAFE_ID.test(bundle[key])) errors.push(`bundle.${key} must be a safe identifier`);
  if (!Number.isInteger(bundle.targetProfileVersion) || bundle.targetProfileVersion < 1) errors.push("bundle.targetProfileVersion must be a positive integer");
  if (!object(bundle.normalizedJdSnapshot) || !relativePath(bundle.normalizedJdSnapshot.localPath) || (bundle.normalizedJdSnapshot.sha256 !== null && !/^[a-f0-9]{64}$/.test(bundle.normalizedJdSnapshot.sha256))) errors.push("bundle.normalizedJdSnapshot is invalid");
  references(bundle.evidenceReferences, "bundle.evidenceReferences", errors);
  for (const key of ["reportPath", "pdfPath", "checklistPath"]) if (bundle[key] !== null && !relativePath(bundle[key])) errors.push(`bundle.${key} must be a safe relative path or null`);
  if (!REVIEW_STATES.has(bundle.reviewState)) errors.push("bundle.reviewState is invalid"); if (!timestamp(bundle.createdAt)) errors.push("bundle.createdAt must be an ISO timestamp"); return errors;
}
export function assertValidMaterialBundle(bundle) { const errors = validateMaterialBundle(bundle); if (errors.length > 0) throw new MaterialBundleValidationError(errors); return bundle; }
export function materialBundlePath(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) { if (!SAFE_ID.test(id)) throw new Error("Material bundle id must be safe."); return join(resolve(rootPath), "material-bundles", `${id}.json`); }
function savePrivate(path, value) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); renameSync(temporary, path); return structuredClone(value); }
export function saveMaterialBundle(bundle, rootPath = DEFAULT_AUTODISCOVERY_PATH) { return savePrivate(materialBundlePath(bundle.id, rootPath), assertValidMaterialBundle(structuredClone(bundle))); }
export function loadMaterialBundle(id, rootPath = DEFAULT_AUTODISCOVERY_PATH) { const path = materialBundlePath(id, rootPath); return existsSync(path) ? assertValidMaterialBundle(JSON.parse(readFileSync(path, "utf8"))) : null; }
function evaluationContext(request) { return Object.freeze({ requestId: request.id, jobId: request.jobId, approval: structuredClone(request.approval), targetProfileVersion: request.workItem.targetProfileVersion, normalizedJdSnapshot: structuredClone(request.workItem.normalizedJdSnapshot), normalizedJob: structuredClone(request.workItem.job), evidenceReferences: structuredClone(request.workItem.evidenceReferences), draftOnly: true, submissionAllowed: false }); }

/** Claims an approved request and delegates to an evaluator adapter returning { reportPath, pdfPath?, checklistPath? }. */
export async function processNextEvaluation({ rootPath = DEFAULT_AUTODISCOVERY_PATH, evaluator, now = new Date() } = {}) {
  if (typeof evaluator !== "function") throw new TypeError("An explicit local evaluator adapter is required.");
  const request = claimNextEvaluation(rootPath, now); if (request === null) return null;
  try {
    const artifacts = await evaluator(evaluationContext(request));
    if (!object(artifacts) || !relativePath(artifacts.reportPath)) throw new Error("Evaluator must return a safe local reportPath.");
    const createdAt = (now instanceof Date ? now : new Date(now)).toISOString();
    const bundle = saveMaterialBundle({ schemaVersion: MATERIAL_BUNDLE_SCHEMA_VERSION, id: `bundle-${request.id.slice(5)}`, requestId: request.id, jobId: request.jobId, targetProfileVersion: request.workItem.targetProfileVersion, normalizedJdSnapshot: structuredClone(request.workItem.normalizedJdSnapshot), evidenceReferences: structuredClone(request.workItem.evidenceReferences), reportPath: artifacts.reportPath, pdfPath: artifacts.pdfPath ?? null, checklistPath: artifacts.checklistPath ?? null, reviewState: "draft-awaiting-review", createdAt }, rootPath);
    finishEvaluationRequest(request.id, { status: "succeeded", now }, rootPath); return { request, bundle, context: evaluationContext(request) };
  } catch (error) { finishEvaluationRequest(request.id, { status: "failed", errorCode: "EVALUATION_FAILED", now }, rootPath); throw error; }
}
