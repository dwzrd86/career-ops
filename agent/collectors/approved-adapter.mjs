import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { detectApi, fetchJson, PARSERS } from "../../scan.mjs";
import { persistUniqueDiscoveredJob } from "./deduplicate.mjs";
import { normalizeCandidate } from "./normalize.mjs";
import { createMatchDecision } from "../matching/score.mjs";
import { DEFAULT_AUTODISCOVERY_PATH, loadMatchDecision, saveMatchDecision } from "../store/discovered-jobs.mjs";

const FEED_HOSTS = {
  greenhouse: new Set(["boards-api.greenhouse.io"]),
  ashby: new Set(["api.ashbyhq.com"]),
  lever: new Set(["api.lever.co"]),
};

function approvedFeed(type, value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && FEED_HOSTS[type]?.has(url.hostname);
  } catch { return false; }
}

function wantedTitle(profile, title) {
  const value = title.toLowerCase();
  if (profile.targetRoles.some((role) => [role.title, ...role.aliases].some((phrase) => value.includes(phrase.toLowerCase())))) return true;
  const cyberProfile = profile.targetRoles.some((role) => /security|cyber|grc|ciso/i.test(role.title));
  return cyberProfile && /\b(security|cybersecurity|grc)\b/i.test(value)
    && /\b(architect|director|head|manager|ciso)\b/i.test(value)
    && !/\b(marketing|sales|account executive|recruiter|software|program manager)\b/i.test(value);
}

function targetsFor(sourceId, portalsPath) {
  const config = yaml.load(readFileSync(portalsPath, "utf8"));
  return (config?.tracked_companies || [])
    .filter((company) => company.enabled !== false)
    .map((company) => ({ company, feed: detectApi(company) }))
    .filter(({ feed }) => feed?.type === sourceId && approvedFeed(sourceId, feed.url));
}

export function createCollectors({ profile, rootPath = DEFAULT_AUTODISCOVERY_PATH, portalsPath = resolve("portals.yml"), fetchFeed = fetchJson }) {
  if (!profile || profile.profileVersion < 1) throw new Error("A saved Target Profile is required.");
  const collect = async ({ sourceId, maxResults, profileVersion }) => {
    if (profileVersion !== profile.profileVersion) return { status: "blocked", resultCount: 0, errorCode: "PROFILE_CHANGED" };
    const targets = targetsFor(sourceId, portalsPath);
    if (targets.length === 0) return { status: "blocked", resultCount: 0, errorCode: "NO_APPROVED_SOURCES" };
    let resultCount = 0;
    let successCount = 0;
    let failureCount = 0;
    for (const { company, feed } of targets) {
      if (resultCount >= maxResults) break;
      try {
        const payload = await fetchFeed(feed.url);
        const postings = PARSERS[sourceId](payload, company.name);
        successCount++;
        for (const posting of postings) {
          if (resultCount >= maxResults) break;
          if (typeof posting.title !== "string" || !wantedTitle(profile, posting.title) || !approvedPostingUrl(posting.url)) continue;
          const job = normalizeCandidate({
            provider: sourceId,
            sourceIdentifier: company.name,
            sourceUrl: feed.url,
            externalId: posting.id == null ? undefined : String(posting.id),
            url: posting.url,
            company: company.name,
            title: posting.title,
            location: typeof posting.location === "string" ? posting.location : null,
          }, { rootPath });
          const saved = persistUniqueDiscoveredJob(job, { rootPath });
          const selected = saved.savedJob ?? saved.existingJob;
          const decision = createMatchDecision(profile, selected);
          if (!loadMatchDecision(decision.id, rootPath)) saveMatchDecision(decision, rootPath);
          if (saved.outcome !== "duplicate") resultCount++;
        }
      } catch {
        failureCount++;
      }
    }
    if (successCount === 0) return { status: "failed", resultCount: 0, errorCode: "FEED_UNAVAILABLE" };
    return { status: failureCount > 0 ? "partial" : "succeeded", resultCount, ...(failureCount > 0 ? { errorCode: "FEED_PARTIAL" } : {}) };
  };
  return Object.fromEntries(["greenhouse", "ashby", "lever"].map((sourceId) => [sourceId, collect]));
}

function approvedPostingUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
