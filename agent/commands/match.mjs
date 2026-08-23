#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMatchDecision } from "../matching/score.mjs";
import { assertValidDiscoveredJob, assertValidMatchDecision, loadDiscoveredJob } from "../store/discovered-jobs.mjs";
import { DEFAULT_TARGET_PROFILE_PATH, TargetProfileValidationError, loadTargetProfile } from "../store/target-profile.mjs";

function usage() {
  console.log(`Usage: npm run match -- [--profile <path>] (--job <normalized-job.json> | --job-id <id> [--data-root <path>])

Print an explainable, deterministic match decision. The Target Profile must be
saved and valid (profileVersion >= 1). Job input must already be a validated,
normalized record; raw resumes and job descriptions are never accepted.
`);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function optionValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function unknownOptions(args) {
  const allowed = new Set(["--profile", "--job", "--job-id", "--data-root", "--help"]);
  for (const arg of args) {
    if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
}

function loadFixtureJob(jobPath) {
  const resolvedPath = resolve(jobPath);
  if (!existsSync(resolvedPath)) throw new Error(`Normalized job file not found: ${resolvedPath}`);
  try {
    return assertValidDiscoveredJob(JSON.parse(readFileSync(resolvedPath, "utf8")));
  } catch (error) {
    throw new Error(`Normalized job file is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadValidatedProfile(profilePath) {
  try {
    const profile = loadTargetProfile(profilePath);
    if (profile === null) throw new Error(`Target Profile not found: ${profilePath}. Run \`npm run profile -- init\` and \`npm run profile -- edit\` first.`);
    if (profile.profileVersion < 1) throw new Error("Target Profile must be saved at least once (profileVersion must be >= 1).");
    return profile;
  } catch (error) {
    if (error instanceof TargetProfileValidationError) throw new Error(`Target Profile is invalid: ${error.message}`);
    throw error;
  }
}

function run() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    usage();
    return;
  }
  unknownOptions(args);
  const profilePath = resolve(optionValue(args, "--profile") || process.env.CAREER_OPS_TARGET_PROFILE || DEFAULT_TARGET_PROFILE_PATH);
  const jobPath = optionValue(args, "--job");
  const jobId = optionValue(args, "--job-id");
  const dataRoot = optionValue(args, "--data-root");
  if ((jobPath && jobId) || (!jobPath && !jobId)) throw new Error("Provide exactly one of --job or --job-id.");
  if (dataRoot && !jobId) throw new Error("--data-root can only be used with --job-id.");

  const profile = loadValidatedProfile(profilePath);
  const job = jobPath ? loadFixtureJob(jobPath) : loadDiscoveredJob(jobId, dataRoot ? resolve(dataRoot) : undefined);
  if (job === null) throw new Error(`Local discovered job not found: ${jobId}`);
  const decision = assertValidMatchDecision(createMatchDecision(profile, job));
  console.log(JSON.stringify(decision, null, 2));
}

try {
  run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
