import { DEFAULT_AUTODISCOVERY_PATH, listDiscoveredJobs, saveDiscoveredJob } from "../store/discovered-jobs.mjs";
import { canonicalizeUrl, normalizedRoleFingerprint } from "./normalize.mjs";

function providerExternalId(job) {
  return job.externalIds?.[job.source.provider] || null;
}

function roleFingerprint(job) {
  return normalizedRoleFingerprint(job.role);
}

/**
 * Applies the required precedence: URL, source-provider external ID, then
 * normalized company/title/location. It returns the existing record only for
 * a duplicate and does not persist anything itself.
 */
export function findDuplicate(job, existingJobs) {
  const canonicalUrl = canonicalizeUrl(job.canonicalUrl);
  const byUrl = existingJobs.find((existing) => canonicalizeUrl(existing.canonicalUrl) === canonicalUrl);
  if (byUrl) return { duplicate: true, reasonCode: "DUPLICATE_CANONICAL_URL", existingJob: byUrl };

  const externalId = providerExternalId(job);
  if (externalId) {
    const byExternalId = existingJobs.find((existing) => existing.source.provider === job.source.provider && providerExternalId(existing) === externalId);
    if (byExternalId) return { duplicate: true, reasonCode: "DUPLICATE_PROVIDER_EXTERNAL_ID", existingJob: byExternalId };
  }

  const fingerprint = roleFingerprint(job);
  const byRole = existingJobs.find((existing) => roleFingerprint(existing) === fingerprint);
  if (byRole) return { duplicate: true, reasonCode: "DUPLICATE_COMPANY_TITLE_LOCATION", existingJob: byRole };
  return { duplicate: false, reasonCode: null, existingJob: null };
}

export function persistUniqueDiscoveredJob(job, { rootPath = DEFAULT_AUTODISCOVERY_PATH } = {}) {
  const duplicate = findDuplicate(job, listDiscoveredJobs(rootPath));
  if (duplicate.duplicate) return { outcome: "duplicate", ...duplicate };
  const savedJob = saveDiscoveredJob(job, rootPath);
  return {
    outcome: savedJob.lifecycle === "expired" ? "expired" : "active",
    duplicate: false,
    reasonCode: savedJob.lifecycle === "expired" ? "POSTING_EXPIRED" : "POSTING_ACTIVE",
    existingJob: null,
    savedJob,
  };
}
