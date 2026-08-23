#!/usr/bin/env node
import { resolve } from "node:path";
import { loadRunQueue, setKillSwitch } from "../store/run-queue.mjs";

function usage() { console.log("Usage: npm run scheduler:status -- [--data-root <path>] [--json] [--kill-switch on|off]"); }
function option(args, flag) { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1] ?? null; }
function summary(queue) {
  const counts = Object.fromEntries(["queued", "running", "succeeded", "partial", "failed", "blocked", "skipped"].map((status) => [status, 0]));
  for (const run of queue.runs) counts[run.status] += 1;
  return { killSwitch: queue.killSwitch, counts, sources: queue.sources, recentRuns: queue.runs.slice(-20) };
}
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return usage();
  const rootPath = option(args, "--data-root");
  const kill = option(args, "--kill-switch");
  if (kill !== null && kill !== "on" && kill !== "off") throw new Error("--kill-switch must be on or off");
  const resolved = rootPath ? resolve(rootPath) : undefined;
  const queue = kill === null ? loadRunQueue(resolved) : setKillSwitch(kill === "on", { rootPath: resolved });
  console.log(JSON.stringify(summary(queue), null, 2));
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
