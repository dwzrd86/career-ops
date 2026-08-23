import { createHash } from "node:crypto";
import { evaluateHardFilters, hardFilterOutcome } from "./rules.mjs";

const WEIGHTS = { role: 35, seniority: 15, framework: 15, cloudPlatform: 15, expertise: 15, preference: 5 };

function normalized(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function exactMatch(values, value) {
  const candidate = normalized(value);
  return candidate !== "" && values.some((entry) => normalized(entry) === candidate);
}

function overlapScore(expected, actual, dimension) {
  if (expected.length === 0) return { score: null, codes: [`${dimension}_NOT_CONFIGURED`] };
  if (actual === undefined || actual === null) return { score: null, codes: [`${dimension}_UNKNOWN`] };
  const matches = expected.filter((entry) => exactMatch(actual, entry));
  const score = Math.round((matches.length / expected.length) * 100);
  return { score, codes: [score > 0 ? `${dimension}_MATCH` : `${dimension}_NO_MATCH`] };
}

function roleScore(profile, job) {
  const title = normalized(job.role.title);
  const matchingRole = profile.targetRoles.find((role) => [role.title, ...role.aliases].some((candidate) => title.includes(normalized(candidate))));
  if (!matchingRole) return { score: 0, codes: ["ROLE_NO_MATCH"] };
  const priorityScores = { primary: 100, secondary: 75, adjacent: 50 };
  return { score: priorityScores[matchingRole.priority], codes: [`ROLE_${matchingRole.priority.toUpperCase()}_MATCH`] };
}

function seniorityScore(profile, job) {
  const expected = profile.targetRoles.flatMap((role) => role.seniority);
  const actual = job.evidence?.seniority;
  if (expected.length === 0) return { score: null, codes: ["SENIORITY_NOT_CONFIGURED"] };
  if (actual === undefined || actual === null) return { score: null, codes: ["SENIORITY_UNKNOWN"] };
  return { score: exactMatch(expected, actual) ? 100 : 0, codes: [exactMatch(expected, actual) ? "SENIORITY_MATCH" : "SENIORITY_NO_MATCH"] };
}

function preferenceScore(profile, job) {
  const companies = profile.preferences.companies;
  const industries = profile.preferences.industries;
  if (companies.length === 0 && industries.length === 0) return { score: null, codes: ["PREFERENCE_NOT_CONFIGURED"] };
  if (industries.length > 0 && job.role.industry === null) return { score: null, codes: ["PREFERENCE_UNKNOWN"] };
  const values = [];
  if (companies.length > 0) values.push(exactMatch(companies, job.role.company));
  if (industries.length > 0) values.push(exactMatch(industries, job.role.industry));
  const score = Math.round((values.filter(Boolean).length / values.length) * 100);
  return { score, codes: [score > 0 ? "PREFERENCE_MATCH" : "PREFERENCE_NO_MATCH"] };
}

function weightedScore(subscores) {
  const included = Object.entries(WEIGHTS).filter(([dimension]) => subscores[dimension] !== null);
  if (included.length === 0) return null;
  const weight = included.reduce((total, [dimension]) => total + WEIGHTS[dimension], 0);
  return Math.round((included.reduce((total, [dimension]) => total + (subscores[dimension] * WEIGHTS[dimension]), 0) / weight) * 100) / 100;
}

export function scoreMatch(profile, job) {
  const dimensions = {
    role: roleScore(profile, job),
    seniority: seniorityScore(profile, job),
    framework: overlapScore(profile.expertise.frameworks, job.evidence?.frameworks, "FRAMEWORK"),
    cloudPlatform: overlapScore(profile.expertise.cloudPlatforms, job.evidence?.cloudPlatforms, "CLOUD_PLATFORM"),
    expertise: overlapScore([...profile.expertise.tools, ...profile.expertise.skills], job.evidence?.expertise, "EXPERTISE"),
    preference: preferenceScore(profile, job),
  };
  const subscores = Object.fromEntries(Object.entries(dimensions).map(([dimension, value]) => [dimension, value.score]));
  return { score: weightedScore(subscores), subscores, explanationCodes: Object.values(dimensions).flatMap((value) => value.codes) };
}

function decisionId(jobId, profileVersion) {
  return `match-${createHash("sha256").update(`${jobId}:${profileVersion}`).digest("hex").slice(0, 32)}`;
}

export function createMatchDecision(profile, job, { decidedAt = new Date().toISOString() } = {}) {
  const hardFilterResults = evaluateHardFilters(profile, job);
  const outcome = hardFilterOutcome(hardFilterResults);
  const base = {
    schemaVersion: 1,
    id: decisionId(job.id, profile.profileVersion),
    jobId: job.id,
    canonicalUrl: job.canonicalUrl,
    profileVersion: profile.profileVersion,
    decidedAt,
    outcome,
    hardFilterResults,
    reviewerOverride: null,
  };
  if (outcome === "rejected") {
    return {
      ...base,
      score: null,
      subscores: { role: null, seniority: null, framework: null, cloudPlatform: null, expertise: null, preference: null },
      explanationCodes: [...hardFilterResults.filter((entry) => entry.outcome === "fail").map((entry) => entry.reasonCode), "RANKING_SKIPPED_HARD_FILTER"],
    };
  }
  const ranked = scoreMatch(profile, job);
  return {
    ...base,
    ...ranked,
    explanationCodes: [...hardFilterResults.filter((entry) => entry.outcome === "unknown").map((entry) => entry.reasonCode), ...ranked.explanationCodes],
  };
}
