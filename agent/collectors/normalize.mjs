import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_AUTODISCOVERY_PATH } from "../store/discovered-jobs.mjs";

const KNOWN_PROVIDERS = new Set(["greenhouse", "ashby", "lever", "interceptor", "manual"]);
const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function nullableText(value) {
  const normalized = text(value);
  return normalized === "" ? null : normalized;
}

function unknownUnless(value, allowed) {
  return allowed.has(value) ? value : "unknown";
}

function detailSnapshot(descriptionText, rootPath) {
  if (descriptionText === undefined || descriptionText === null || text(descriptionText) === "") {
    return { sha256: null, localPath: null };
  }
  if (typeof descriptionText !== "string") throw new TypeError("descriptionText must be a string when supplied");

  const normalized = descriptionText.replace(/\r\n/g, "\n").trim();
  const sha256 = createHash("sha256").update(normalized).digest("hex");
  const directory = join(resolve(rootPath), "details");
  const path = join(directory, `${sha256}.txt`);
  if (!existsSync(path)) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, `${normalized}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return { sha256, localPath: join("details", `${sha256}.txt`) };
}

export function canonicalizeUrl(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("candidate URL is required");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("candidate URL must use HTTP(S)");
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  for (const [key] of url.searchParams) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function normalizedRoleFingerprint({ company, title, location }) {
  return [company, title, location]
    .map((value) => text(value).toLocaleLowerCase())
    .join("::");
}

function deterministicId(provider, sourceIdentifier, externalId, canonicalUrl) {
  const digest = createHash("sha256")
    .update([provider, sourceIdentifier, externalId || "", canonicalUrl].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${provider}-${digest}`;
}

function inferWorkplaceMode(location, supplied) {
  if (new Set(["remote", "hybrid", "onsite"]).has(supplied)) return supplied;
  const normalizedLocation = text(location).toLocaleLowerCase();
  if (normalizedLocation.includes("hybrid")) return "hybrid";
  if (normalizedLocation.includes("remote")) return "remote";
  return "unknown";
}

function normalizeSalary(salary) {
  if (!salary || typeof salary !== "object") return null;
  const minimum = Number.isFinite(salary.minimum) ? salary.minimum : null;
  const maximum = Number.isFinite(salary.maximum) ? salary.maximum : null;
  const currency = text(salary.currency).toUpperCase();
  const basis = new Set(["annual", "hourly", "unknown"]).has(salary.basis) ? salary.basis : "unknown";
  return currency.length === 3 ? { minimum, maximum, currency, basis } : null;
}

/**
 * Converts a collector candidate to the validated metadata-only job contract.
 * Raw detail text is written only to the ignored local details directory and is
 * never included in the returned record.
 */
export function normalizeCandidate(candidate, { now = new Date().toISOString(), rootPath = DEFAULT_AUTODISCOVERY_PATH } = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("candidate must be an object");
  const provider = candidate.provider || candidate.source?.provider;
  if (!KNOWN_PROVIDERS.has(provider)) throw new TypeError("candidate provider is not supported");
  const sourceIdentifier = text(candidate.sourceIdentifier || candidate.source?.identifier);
  const sourceUrl = canonicalizeUrl(candidate.sourceUrl || candidate.source?.sourceUrl || candidate.url);
  const canonicalUrl = canonicalizeUrl(candidate.canonicalUrl || candidate.url);
  const company = text(candidate.company || candidate.role?.company);
  const title = text(candidate.title || candidate.role?.title);
  if (sourceIdentifier === "" || company === "" || title === "") throw new TypeError("candidate source identifier, company, and title are required");

  const externalId = text(candidate.externalId || candidate.externalIds?.[provider] || candidate.id);
  const externalIds = { ...(candidate.externalIds || {}) };
  if (externalId) externalIds[provider] = externalId;
  const location = nullableText(candidate.location || candidate.role?.location);
  const lifecycle = new Set(["active", "expired", "unknown"]).has(candidate.lifecycle) ? candidate.lifecycle : "active";

  const record = {
    schemaVersion: 1,
    id: deterministicId(provider, sourceIdentifier, externalId, canonicalUrl),
    canonicalUrl,
    externalIds,
    source: { provider, identifier: sourceIdentifier, sourceUrl },
    role: {
      company,
      title,
      location,
      workplaceMode: inferWorkplaceMode(location, candidate.workplaceMode || candidate.role?.workplaceMode),
      employmentType: nullableText(candidate.employmentType || candidate.role?.employmentType),
      industry: nullableText(candidate.industry || candidate.role?.industry),
      salary: normalizeSalary(candidate.salary || candidate.role?.salary),
      workAuthorization: unknownUnless(candidate.workAuthorization || candidate.role?.workAuthorization, new Set(["required", "not-required"])),
      clearance: unknownUnless(candidate.clearance || candidate.role?.clearance, new Set(["required", "not-required"])),
    },
    description: detailSnapshot(candidate.descriptionText, rootPath),
    postedAt: candidate.postedAt || null,
    discoveredAt: candidate.discoveredAt || now,
    normalizedAt: now,
    lifecycle,
  };
  if (candidate.evidence !== undefined) record.evidence = candidate.evidence;
  return record;
}
