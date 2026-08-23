// Local-only daily review artifact. This module deliberately has no network,
// email, evaluator, browser, or Convex client dependency. An optional payload
// is written locally for a separately authenticated private Convex bridge.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_AUTODISCOVERY_PATH, listDiscoveredJobs, listMatchDecisions } from "./store/discovered-jobs.mjs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_LABELS = Object.freeze({ greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever", interceptor: "Interceptor", manual: "Manual" });

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("now must be a valid date");
  return date.toISOString();
}

function dateKey(value) {
  const parsed = typeof value === "string" && DATE.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (parsed === null || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError("date must use YYYY-MM-DD");
  }
  return value;
}

function scoreValue(score) { return Number.isFinite(score) ? score : -1; }
function effectiveOutcome(decision) { return decision.reviewerOverride?.outcome ?? decision.outcome; }
function markdownCell(value) { return String(value ?? "—").replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim() || "—"; }
function limit(value, maximum) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum); }

function freshness(job, now) {
  if (job.lifecycle === "expired") return "expired";
  if (job.lifecycle !== "active") return "unknown";
  return now.valueOf() - Date.parse(job.normalizedAt) > STALE_AFTER_MS ? "stale" : "fresh";
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function asConvexProjection(entry) {
  const url = httpsUrl(entry.job.canonicalUrl);
  if (!url) return null;
  const provider = entry.job.source.provider;
  const sourceIdentifier = limit(entry.job.source.identifier, 120);
  const sourceLabel = limit(`${PROVIDER_LABELS[provider] ?? provider}: ${sourceIdentifier}`, 160);
  const company = limit(entry.job.role.company, 160);
  const title = limit(entry.job.role.title, 200);
  if (!company || !title || !sourceLabel) return null;
  const location = entry.job.role.location === null ? undefined : limit(entry.job.role.location, 160) || undefined;
  return {
    localJobId: entry.job.id,
    company,
    title,
    ...(location === undefined ? {} : { location }),
    url,
    source: { label: sourceLabel, provider },
    freshness: {
      checkedAt: Date.parse(entry.job.normalizedAt),
      ...(entry.job.postedAt === null ? {} : { postedAt: Date.parse(entry.job.postedAt) }),
      status: entry.freshness,
    },
    discoveredAt: Date.parse(entry.job.discoveredAt),
    decision: {
      profileVersion: entry.decision.profileVersion,
      outcome: "ranked",
      ...(Number.isFinite(entry.decision.score) ? { score: entry.decision.score } : {}),
      hardFilters: entry.decision.hardFilterResults.map((filter) => ({
        ruleId: filter.ruleId,
        reasonCode: filter.reasonCode,
        outcome: filter.outcome === "not-applicable" ? "notApplicable" : filter.outcome,
      })),
      explanationCodes: [...entry.decision.explanationCodes],
      decidedAt: Date.parse(entry.decision.decidedAt),
    },
  };
}

function artifact(entries, { date, generatedAt, profileVersion }) {
  const rows = entries.map((entry) => [
    markdownCell(entry.job.role.title),
    markdownCell(entry.job.role.company),
    markdownCell(entry.job.role.location),
    Number.isFinite(entry.decision.score) ? entry.decision.score.toFixed(2).replace(/\.00$/, "") : "Not scored",
    markdownCell(entry.job.canonicalUrl),
    markdownCell(entry.decision.explanationCodes.join(", ")),
  ]);
  return [
    `# Daily discovery shortlist — ${date}`,
    "",
    `Generated locally at ${generatedAt} from ranked decisions for Target Profile v${profileVersion}.`,
    "This is a review queue only: it does not evaluate roles, generate materials, submit applications, send email, or contact a third party.",
    "",
    "| Role | Company | Location | Score | URL | Match signals |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...(rows.length === 0 ? ["| No active ranked decisions | — | — | — | — | — |"] : rows.map((row) => `| ${row.join(" | ")} |`)),
    "",
  ].join("\n");
}

function writePrivate(path, contents) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

export function currentRankedDecisions({ jobs, decisions, profileVersion, now = new Date() }) {
  if (!Number.isInteger(profileVersion) || profileVersion < 1) throw new TypeError("profileVersion must be a positive integer");
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return decisions
    .filter((decision) => decision.profileVersion === profileVersion && effectiveOutcome(decision) === "ranked")
    .map((decision) => ({ decision, job: jobById.get(decision.jobId) }))
    .filter((entry) => entry.job && entry.job.lifecycle === "active" && entry.job.canonicalUrl === entry.decision.canonicalUrl)
    .map((entry) => ({ ...entry, freshness: freshness(entry.job, now) }))
    .sort((left, right) => scoreValue(right.decision.score) - scoreValue(left.decision.score)
      || Date.parse(right.job.discoveredAt) - Date.parse(left.job.discoveredAt)
      || left.job.id.localeCompare(right.job.id));
}

/**
 * Creates the local review artifact. `includeProjection` merely writes a
 * bounded Convex `discovery:project` payload to disk; it never performs a
 * network request. Uploading it requires a separate, explicit authenticated
 * bridge and is intentionally outside the scheduler.
 */
export function generateDailyShortlist({
  rootPath = DEFAULT_AUTODISCOVERY_PATH,
  profileVersion,
  now = new Date(),
  date = undefined,
  includeProjection = false,
} = {}) {
  const generatedAt = iso(now);
  const day = dateKey(date ?? generatedAt.slice(0, 10));
  const root = resolve(rootPath);
  const entries = currentRankedDecisions({
    jobs: listDiscoveredJobs(root),
    decisions: listMatchDecisions(root),
    profileVersion,
    now: new Date(generatedAt),
  });
  const artifactPath = writePrivate(join(root, "review", `daily-shortlist-${day}.md`), artifact(entries, { date: day, generatedAt, profileVersion }));
  let projectionPath = null;
  let projectedCount = 0;
  if (includeProjection) {
    const items = entries.map(asConvexProjection).filter(Boolean);
    projectionPath = writePrivate(join(root, "projections", `daily-shortlist-${day}.json`), `${JSON.stringify({
      schemaVersion: 1,
      kind: "career-ops/convex-discovery-project",
      generatedAt,
      profileVersion,
      items,
    }, null, 2)}\n`);
    projectedCount = items.length;
  }
  return { date: day, generatedAt, profileVersion, reviewCount: entries.length, projectedCount, artifactPath, projectionPath };
}
