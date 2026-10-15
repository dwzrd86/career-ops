#!/usr/bin/env node
import { resolve } from "node:path";
import { DEFAULT_AUTODISCOVERY_PATH, listDiscoveredJobs, listMatchDecisions } from "../store/discovered-jobs.mjs";
import { DEFAULT_TARGET_PROFILE_PATH, loadTargetProfile } from "../store/target-profile.mjs";

function option(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run discovery:review -- [--profile path] [--data-root path]");
    return;
  }
  const profile = loadTargetProfile(resolve(option(args, "--profile") || DEFAULT_TARGET_PROFILE_PATH));
  if (!profile) throw new Error("Save a Target Profile before reviewing jobs.");
  const root = resolve(option(args, "--data-root") || DEFAULT_AUTODISCOVERY_PATH);
  const jobs = new Map(listDiscoveredJobs(root).map((job) => [job.id, job]));
  const decisions = listMatchDecisions(root).filter((decision) => decision.profileVersion === profile.profileVersion);
  const review = decisions
    .filter((decision) => (decision.reviewerOverride?.outcome || decision.outcome) !== "rejected")
    .map((decision) => ({ decision, job: jobs.get(decision.jobId) }))
    .filter(({ job }) => job?.lifecycle === "active")
    .sort((left, right) => (right.decision.score ?? 0) - (left.decision.score ?? 0) || left.job.role.company.localeCompare(right.job.role.company));
  console.log(`Target Profile v${profile.profileVersion}: ${review.length} roles to review; ${decisions.length - review.length} rejected by current rules.\n`);
  for (const { decision, job } of review) {
    const unknown = decision.hardFilterResults.filter((entry) => entry.outcome === "unknown").map((entry) => entry.ruleId.toLowerCase().replaceAll("_", " "));
    console.log(`${job.role.company} | ${job.role.title} | ${job.role.location || "Location unknown"}`);
    console.log(`  ${job.canonicalUrl}`);
    const roleSignal = decision.explanationCodes.includes("ROLE_NO_MATCH") ? "adjacent title" : `match score ${decision.score ?? "unscored"}`;
    console.log(`  ${decision.outcome}; ${roleSignal}; check: ${unknown.join(", ") || "none"}\n`);
  }
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
