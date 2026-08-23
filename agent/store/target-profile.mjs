import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

export const TARGET_PROFILE_SCHEMA_VERSION = 1;
export const DEFAULT_TARGET_PROFILE_PATH = resolve("config/target-profile.yml");

const workplaceModes = new Set(["remote", "hybrid", "onsite"]);
const priorities = new Set(["primary", "secondary", "adjacent"]);
const discoverySources = new Set(["greenhouse", "ashby", "lever", "interceptor"]);
const schedules = new Set(["manual", "daily", "weekdays"]);
const INTERCEPTOR_CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export class TargetProfileValidationError extends Error {
  constructor(errors) {
    super(`Target Profile is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "TargetProfileValidationError";
    this.errors = errors;
  }
}

export function emptyTargetProfile() {
  return {
    schemaVersion: TARGET_PROFILE_SCHEMA_VERSION,
    profileVersion: 0,
    updatedAt: null,
    targetRoles: [],
    location: { home: "", radiusMiles: null, workplaceModes: ["remote"], allowedRegions: [], excludedRegions: [] },
    compensation: { floor: null, target: null, currency: "USD", basis: "annual" },
    eligibility: { workAuthorization: [], clearance: { required: false, levels: [] } },
    preferences: { industries: [], excludedIndustries: [], companies: [], excludedCompanies: [] },
    expertise: { frameworks: [], cloudPlatforms: [], tools: [], skills: [] },
    criteria: { mustHave: [], dealBreakers: [], notes: "" },
    evidenceReferences: [],
    discovery: {
      sources: ["greenhouse", "ashby", "lever"],
      schedule: "manual",
      maxPerRun: 100,
      enabled: true,
      interceptor: { contextId: null, allowedSources: [] },
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, path, errors) {
  if (!isPlainObject(value)) errors.push(`${path} must be an object`);
  return isPlainObject(value);
}

function requireStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`${path} must be an array of non-empty strings`);
    return false;
  }
  return true;
}

function requireOptionalMoney(value, path, errors) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) errors.push(`${path} must be a non-negative number or null`);
}

function requireInterceptorConfiguration(value, sources, errors) {
  if (value === undefined && (!Array.isArray(sources) || !sources.includes("interceptor"))) return;
  if (!isPlainObject(value)) {
    errors.push("discovery.interceptor must be an object");
    return;
  }
  const allowedKeys = new Set(["contextId", "allowedSources"]);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) errors.push(`discovery.interceptor.${key} is not allowed`);
  const validContext = value.contextId === null || (typeof value.contextId === "string" && INTERCEPTOR_CONTEXT_ID_PATTERN.test(value.contextId));
  if (!validContext) errors.push("discovery.interceptor.contextId must be a safe context ID or null");
  const validSources = requireStringArray(value.allowedSources, "discovery.interceptor.allowedSources", errors);
  if (validSources) {
    value.allowedSources.forEach((source, index) => {
      try {
        const url = new URL(source);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("not an HTTPS origin/path");
      } catch {
        errors.push(`discovery.interceptor.allowedSources[${index}] must be an HTTPS URL without credentials, query, or fragment`);
      }
    });
  }
  if (Array.isArray(sources) && sources.includes("interceptor")) {
    if (value.contextId === null) errors.push("discovery.interceptor.contextId is required when Interceptor is enabled");
    if (!Array.isArray(value.allowedSources) || value.allowedSources.length === 0) errors.push("discovery.interceptor.allowedSources is required when Interceptor is enabled");
  }
}

export function validateTargetProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return ["profile must be an object"];
  if (profile.schemaVersion !== TARGET_PROFILE_SCHEMA_VERSION) errors.push(`schemaVersion must equal ${TARGET_PROFILE_SCHEMA_VERSION}`);
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 0) errors.push("profileVersion must be a non-negative integer");

  if (!Array.isArray(profile.targetRoles) || profile.targetRoles.length === 0) {
    errors.push("targetRoles must contain at least one role");
  } else {
    profile.targetRoles.forEach((role, index) => {
      const path = `targetRoles[${index}]`;
      if (!requireObject(role, path, errors)) return;
      if (typeof role.title !== "string" || role.title.trim().length < 2) errors.push(`${path}.title must be at least 2 characters`);
      requireStringArray(role.aliases, `${path}.aliases`, errors);
      if (!priorities.has(role.priority)) errors.push(`${path}.priority must be primary, secondary, or adjacent`);
      requireStringArray(role.seniority, `${path}.seniority`, errors);
    });
  }

  if (requireObject(profile.location, "location", errors)) {
    if (typeof profile.location.home !== "string") errors.push("location.home must be a string");
    if (profile.location.radiusMiles !== null && (!Number.isInteger(profile.location.radiusMiles) || profile.location.radiusMiles < 0)) errors.push("location.radiusMiles must be a non-negative integer or null");
    if (requireStringArray(profile.location.workplaceModes, "location.workplaceModes", errors) && profile.location.workplaceModes.some((mode) => !workplaceModes.has(mode))) errors.push("location.workplaceModes may contain remote, hybrid, or onsite only");
    requireStringArray(profile.location.allowedRegions, "location.allowedRegions", errors);
    requireStringArray(profile.location.excludedRegions, "location.excludedRegions", errors);
  }

  if (requireObject(profile.compensation, "compensation", errors)) {
    requireOptionalMoney(profile.compensation.floor, "compensation.floor", errors);
    requireOptionalMoney(profile.compensation.target, "compensation.target", errors);
    if (profile.compensation.floor !== null && profile.compensation.target !== null && profile.compensation.target < profile.compensation.floor) errors.push("compensation.target must not be lower than compensation.floor");
    if (typeof profile.compensation.currency !== "string" || profile.compensation.currency.length !== 3) errors.push("compensation.currency must be a 3-letter currency code");
    if (profile.compensation.basis !== "annual") errors.push("compensation.basis must be annual for MVP matching");
  }

  if (requireObject(profile.eligibility, "eligibility", errors)) {
    requireStringArray(profile.eligibility.workAuthorization, "eligibility.workAuthorization", errors);
    if (requireObject(profile.eligibility.clearance, "eligibility.clearance", errors)) {
      if (typeof profile.eligibility.clearance.required !== "boolean") errors.push("eligibility.clearance.required must be boolean");
      requireStringArray(profile.eligibility.clearance.levels, "eligibility.clearance.levels", errors);
    }
  }

  for (const [section, fields] of Object.entries({
    preferences: ["industries", "excludedIndustries", "companies", "excludedCompanies"],
    expertise: ["frameworks", "cloudPlatforms", "tools", "skills"],
    criteria: ["mustHave", "dealBreakers"],
  })) {
    if (requireObject(profile[section], section, errors)) {
      for (const field of fields) requireStringArray(profile[section][field], `${section}.${field}`, errors);
    }
  }
  if (isPlainObject(profile.criteria) && typeof profile.criteria.notes !== "string") errors.push("criteria.notes must be a string");

  if (!Array.isArray(profile.evidenceReferences)) {
    errors.push("evidenceReferences must be an array");
  } else {
    profile.evidenceReferences.forEach((reference, index) => {
      const path = `evidenceReferences[${index}]`;
      if (!requireObject(reference, path, errors)) return;
      for (const field of ["kind", "localPath", "label"]) {
        if (typeof reference[field] !== "string" || reference[field].trim() === "") errors.push(`${path}.${field} must be a non-empty string`);
      }
      if (reference.updatedAt !== null && typeof reference.updatedAt !== "string") errors.push(`${path}.updatedAt must be an ISO timestamp or null`);
    });
  }

  if (requireObject(profile.discovery, "discovery", errors)) {
    if (requireStringArray(profile.discovery.sources, "discovery.sources", errors) && profile.discovery.sources.some((source) => !discoverySources.has(source))) errors.push("discovery.sources may contain greenhouse, ashby, lever, or interceptor only");
    if (!schedules.has(profile.discovery.schedule)) errors.push("discovery.schedule must be manual, daily, or weekdays");
    if (!Number.isInteger(profile.discovery.maxPerRun) || profile.discovery.maxPerRun < 1 || profile.discovery.maxPerRun > 500) errors.push("discovery.maxPerRun must be an integer from 1 through 500");
    if (typeof profile.discovery.enabled !== "boolean") errors.push("discovery.enabled must be boolean");
    requireInterceptorConfiguration(profile.discovery.interceptor, profile.discovery.sources, errors);
  }

  return errors;
}

export function assertValidTargetProfile(profile) {
  const errors = validateTargetProfile(profile);
  if (errors.length > 0) throw new TargetProfileValidationError(errors);
  return profile;
}

export function loadTargetProfile(profilePath = DEFAULT_TARGET_PROFILE_PATH) {
  if (!existsSync(profilePath)) return null;
  const parsed = yaml.load(readFileSync(profilePath, "utf8"));
  return assertValidTargetProfile(parsed);
}

export function saveTargetProfile(profile, profilePath = DEFAULT_TARGET_PROFILE_PATH) {
  const next = structuredClone(profile);
  const existing = existsSync(profilePath) ? loadTargetProfile(profilePath) : null;
  const expectedProfileVersion = existing?.profileVersion ?? 0;
  if (next.profileVersion !== expectedProfileVersion) {
    throw new TargetProfileValidationError([`profileVersion is stale; reload the profile before saving (expected ${expectedProfileVersion})`]);
  }
  next.schemaVersion = TARGET_PROFILE_SCHEMA_VERSION;
  next.profileVersion = expectedProfileVersion + 1;
  next.updatedAt = new Date().toISOString();
  assertValidTargetProfile(next);

  mkdirSync(dirname(profilePath), { recursive: true });
  const temporaryPath = `${profilePath}.tmp`;
  writeFileSync(temporaryPath, yaml.dump(next, { lineWidth: 100, noRefs: true, sortKeys: false }), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, profilePath);
  return next;
}
