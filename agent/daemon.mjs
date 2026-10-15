#!/usr/bin/env node
// Local scheduler entrypoint. It has no evaluator, model, browser-control, or
// Convex import. Deployments provide a narrow collector adapter explicitly.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { generateDailyShortlist } from "./daily-shortlist.mjs";
import { loadTargetProfile, DEFAULT_TARGET_PROFILE_PATH } from "./store/target-profile.mjs";
import { listMatchDecisions } from "./store/discovered-jobs.mjs";
import { requestCollectionRun } from "./scheduler.mjs";

function usage() {
  console.log(`Usage: node agent/daemon.mjs (--once | --scheduled) [--profile <path>] [--data-root <path>] [--collector-adapter <module>]\n\nRuns only metadata-safe collectors. Collector adapters export { collectors }, keyed by source ID.`);
}
function option(args, flag) { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1] ?? null; }
async function collectorsFrom(args, profile, rootPath) {
  const adapter = option(args, "--collector-adapter");
  if (!adapter) return {};
  const module = await import(pathToFileURL(resolve(adapter)).href);
  if (typeof module.createCollectors === "function") return module.createCollectors({ profile, rootPath });
  if (!module.collectors || typeof module.collectors !== "object") throw new Error("Collector adapter must export collectors or createCollectors.");
  return module.collectors;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || (!args.includes("--once") && !args.includes("--scheduled"))) { usage(); return; }
  if (args.includes("--once") && args.includes("--scheduled")) throw new Error("Choose exactly one of --once or --scheduled.");
  const profilePath = resolve(option(args, "--profile") || process.env.CAREER_OPS_TARGET_PROFILE || DEFAULT_TARGET_PROFILE_PATH);
  const profile = loadTargetProfile(profilePath);
  if (!profile || profile.profileVersion < 1) throw new Error("A saved, valid Target Profile is required before collection.");
  const rootPath = option(args, "--data-root") ? resolve(option(args, "--data-root")) : undefined;
  const settings = { rootPath, collectors: await collectorsFrom(args, profile, rootPath) };
  // systemd supplies the randomized delay. Running immediately here preserves
  // the one-shot service lifecycle while retaining scheduler safety limits.
  const result = args.includes("--once")
    ? await requestCollectionRun(profile, { ...settings, trigger: "manual" })
    : await requestCollectionRun(profile, { ...settings, trigger: "scheduled", options: { maxJitterMs: 0 } });
  // A scheduled run may refresh its *local* review queue. This is intentionally
  // after collection, has no projection/network switch, and never evaluates or
  // generates application materials.
  const shortlist = args.includes("--scheduled") && result.status === "ok"
    ? generateDailyShortlist({ rootPath: settings.rootPath, profileVersion: profile.profileVersion })
    : null;
  const decisions = result.status === "ok"
    ? listMatchDecisions(settings.rootPath).filter((decision) => decision.profileVersion === profile.profileVersion)
    : [];
  console.log(JSON.stringify({
    ...result,
    ...(result.status === "ok" ? { reviewQueue: {
      needsReview: decisions.filter((decision) => decision.outcome === "needs-review").length,
      ranked: decisions.filter((decision) => decision.outcome === "ranked").length,
      rejected: decisions.filter((decision) => decision.outcome === "rejected").length,
    } } : {}),
    ...(shortlist === null ? {} : { dailyShortlist: { date: shortlist.date, reviewCount: shortlist.reviewCount } }),
  }, null, 2));
  if (result.status === "busy") process.exitCode = 3;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
