#!/usr/bin/env node
import { resolve } from "node:path";
import { generateDailyShortlist } from "../daily-shortlist.mjs";
import { DEFAULT_TARGET_PROFILE_PATH, loadTargetProfile } from "../store/target-profile.mjs";

function usage() {
  console.log(`Usage: npm run daily-shortlist -- [--profile <path>] [--data-root <path>] [--date YYYY-MM-DD] [--projection]

Writes a local review artifact from active ranked decisions for the saved Target
Profile. --projection writes a bounded local payload compatible with Convex
discovery:project; it does not connect to Convex, email anyone, or send data.`);
}

function option(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function assertKnownOptions(args) {
  const allowed = new Set(["--profile", "--data-root", "--date", "--projection", "--help"]);
  for (const arg of args) if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return usage();
  assertKnownOptions(args);
  const profilePath = resolve(option(args, "--profile") || process.env.CAREER_OPS_TARGET_PROFILE || DEFAULT_TARGET_PROFILE_PATH);
  const profile = loadTargetProfile(profilePath);
  if (!profile || profile.profileVersion < 1) throw new Error("A saved, valid Target Profile is required before generating a daily shortlist.");
  const dataRoot = option(args, "--data-root");
  const result = generateDailyShortlist({
    profileVersion: profile.profileVersion,
    ...(dataRoot === null ? {} : { rootPath: resolve(dataRoot) }),
    ...(option(args, "--date") === null ? {} : { date: option(args, "--date") }),
    includeProjection: args.includes("--projection"),
  });
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
