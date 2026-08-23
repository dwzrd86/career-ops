import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyTargetProfile } from "../store/target-profile.mjs";
import { acquireRunLock, loadRunQueue, setKillSwitch } from "../store/run-queue.mjs";
import { jitterDelay, queueCollectionRun, requestCollectionRun, runDueCollections } from "../scheduler.mjs";

function clockAt(value) {
  let now = new Date(value);
  return { clock: () => new Date(now), advance(ms) { now = new Date(now.valueOf() + ms); } };
}

function profile(sources = ["greenhouse", "ashby"]) {
  const result = emptyTargetProfile();
  result.profileVersion = 3;
  result.targetRoles = [{ title: "Security Architect", aliases: [], priority: "primary", seniority: ["Principal"] }];
  result.location.allowedRegions = ["United States"];
  result.eligibility.workAuthorization = ["US work authorized"];
  result.criteria.mustHave = ["Architecture"];
  result.discovery.sources = sources;
  result.discovery.maxPerRun = 3;
  return result;
}

function root() { return mkdtempSync(join(tmpdir(), "career-ops-scheduler-")); }

test("scheduled work has deterministic jitter and manual runs start immediately", () => {
  const tick = clockAt("2026-08-23T12:00:00.000Z");
  const dataRoot = root();
  assert.equal(jitterDelay({ maxJitterMs: 100 }, () => 0.5), 50);
  const scheduled = queueCollectionRun(profile(["greenhouse"]), { trigger: "scheduled", rootPath: dataRoot, clock: tick.clock, random: () => 0.5, options: { maxJitterMs: 100 } });
  assert.equal(scheduled.queued[0].scheduledAt, "2026-08-23T12:00:00.050Z");
  const manual = queueCollectionRun(profile(["ashby"]), { trigger: "manual", rootPath: dataRoot, clock: tick.clock });
  assert.equal(manual.queued[0].scheduledAt, "2026-08-23T12:00:00.000Z");
});

test("manual collection limits source concurrency and caps each collector result", async () => {
  const tick = clockAt("2026-08-23T12:00:00.000Z");
  const dataRoot = root();
  let active = 0;
  let peak = 0;
  const collector = async ({ maxResults }) => {
    active += 1; peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    assert.equal(maxResults, 3);
    return { status: "succeeded", resultCount: 99 };
  };
  const result = await requestCollectionRun(profile(), { rootPath: dataRoot, clock: tick.clock, collectors: { greenhouse: collector, ashby: collector }, options: { maxSourceConcurrency: 1 } });
  assert.equal(result.status, "ok");
  assert.equal(peak, 1);
  assert.deepEqual(result.runs.map((run) => run.resultCount), [3, 3]);
  assert.equal(loadRunQueue(dataRoot).runs.every((run) => run.status === "succeeded"), true);
});

test("a failed collector receives bounded exponential retries then a source cooldown", async () => {
  const tick = clockAt("2026-08-23T12:00:00.000Z");
  const dataRoot = root();
  const target = profile(["greenhouse"]);
  let calls = 0;
  const settings = { rootPath: dataRoot, clock: tick.clock, collectors: { greenhouse: async () => { calls += 1; return { status: "failed", errorCode: "NETWORK_DOWN" }; } }, options: { maxRetries: 1, retryBaseMs: 1000, cooldownMs: 5000 } };
  const first = await requestCollectionRun(target, settings);
  assert.equal(first.runs[0].status, "queued");
  assert.equal(first.runs[0].nextAttemptAt, "2026-08-23T12:00:01.000Z");
  assert.equal(calls, 1);
  tick.advance(1000);
  const second = await runDueCollections(target, settings);
  assert.equal(second.runs[0].status, "failed");
  const queue = loadRunQueue(dataRoot);
  assert.equal(queue.sources.greenhouse.failureCount, 2);
  assert.equal(queue.sources.greenhouse.cooldownUntil, "2026-08-23T12:00:06.000Z");
});

test("blocked browser results do not retry and the kill switch prevents new collection", async () => {
  const tick = clockAt("2026-08-23T12:00:00.000Z");
  const dataRoot = root();
  let calls = 0;
  const target = profile(["interceptor"]);
  const result = await requestCollectionRun(target, { rootPath: dataRoot, clock: tick.clock, collectors: { interceptor: async () => { calls += 1; return { status: "blocked", errorCode: "MISSING_CONTEXT" }; } } });
  assert.equal(result.runs[0].status, "blocked");
  assert.equal(result.runs[0].nextAttemptAt, null);
  setKillSwitch(true, { rootPath: dataRoot, now: tick.clock() });
  const killed = await requestCollectionRun(target, { rootPath: dataRoot, clock: tick.clock, collectors: { interceptor: async () => { calls += 1; return { status: "succeeded", resultCount: 0 }; } } });
  assert.equal(killed.status, "killed");
  assert.equal(calls, 1);
});

test("the single-run lock refuses concurrent scheduler invocations", () => {
  const dataRoot = root();
  const first = acquireRunLock(dataRoot);
  assert.ok(first);
  assert.equal(acquireRunLock(dataRoot), null);
  first.release();
  assert.ok(acquireRunLock(dataRoot));
});
