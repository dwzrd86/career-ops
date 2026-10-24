import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { createIsolatedDeployment, provisionDisposableAccount, jobInput, discoveryProjection } from "./authorizationFixtures";
import { ACCOUNT_EXPORT_LIMITS } from "./account";
import { ownedAccountData } from "./accountLifecycle";
import { HOSTED_CONSENT_VERSION } from "./hostedResumes";
import { PRIVACY_POLICY_VERSION } from "./privacy";

const price = { provider: "zai", model: "glm-4.7", inputMicroUsdPerMillion: 600_000,
  outputMicroUsdPerMillion: 2_200_000, maxInputTokens: 8_000, maxTotalOutputTokens: 2_000,
  evidence: "fictional-lifecycle-bounds", validUntil: Date.UTC(2027, 0, 1) };
const consent = { provider: "zai", model: "glm-4.7", version: HOSTED_CONSENT_VERSION, shareSelectedEvidence: true } as const;
const draft = "Fictional Candidate\nSQL reporting";
const response = () => Response.json({ model: "glm-4.7", choices: [{ finish_reason: "stop",
  message: { role: "assistant", content: draft } }], usage: { prompt_tokens: 2000, completion_tokens: 100, total_tokens: 2100 } });
let network = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
  vi.stubEnv("HOSTED_AI_EXECUTION_ENABLED", "true");
  vi.stubEnv("HOSTED_AI_ZAI_API_KEY", "fictional-lifecycle-key");
  vi.stubEnv("HOSTED_AI_ZAI_BOUND_EVIDENCE", price.evidence);
  network = vi.fn(async () => response()); vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = createIsolatedDeployment();
  const a = await provisionDisposableAccount(t, "lifecycle-a");
  const b = await provisionDisposableAccount(t, "lifecycle-b");
  const jobId = await a.client.mutation(api.jobs.create, jobInput("lifecycle-a"));
  const saved = { jobId, sourceResume: draft, description: "SQL reporting role", resume: "Reviewed fictional draft",
    reviewed: true, expectedRevision: null };
  await a.client.mutation(api.resumeBundles.save, saved);
  const foreignJob = await b.client.mutation(api.jobs.create, jobInput("lifecycle-b"));
  await b.client.mutation(api.resumeBundles.save, { ...saved, jobId: foreignJob });
  await t.mutation(internal.aiBudget.configure, { enabled: true, cutoffMicroUsd: 8_000_000 });
  await t.mutation(internal.aiBudget.approvePrice, price);
  for (const account of [a, b]) await t.mutation(internal.aiBudget.setPilotOwner, { ownerId: account.userId as Id<"users">, active: true });
  return { t, a, b, jobId, foreignJob, saved, input: { jobId, expectedRevision: 1, consent },
    drain: () => t.finishAllScheduledFunctions(() => vi.runOnlyPendingTimers()) };
}

// Seed valid historical records, then call the actual owner-scoped export and
// deletion functions. No replacement authorization/cleanup implementation.
async function atCapacity(f: Awaited<ReturnType<typeof fixture>>) {
  const discovered = (await f.a.client.mutation(api.discovery.project, discoveryProjection("lifecycle-a"))).discoveredJobId;
  await f.a.client.mutation(api.discovery.overrideDecision, { id: discovered, outcome: "ranked", reason: "Fictional relevant SQL experience" });
  await f.a.client.mutation(api.account.recordExportRequest, {});
  await f.a.client.mutation(api.targetProfile.save, { profile: {
    targetRoles: [{ title: "SQL Analyst", aliases: [], seniority: [] }], home: "Nashville", workplaceModes: ["remote"],
    allowedRegions: ["United States"], preferredRegions: [], dreamRegions: [], dreamIndustries: [], excludedCompanies: [],
    excludedIndustries: [], frameworks: [], cloudPlatforms: [], currency: "USD", workAuthorization: [], clearanceLevels: [],
    sources: ["greenhouse"], schedule: "manual", enabled: true,
  } });
  const requestId = await f.a.client.mutation(api.hostedResumes.request, f.input);
  await f.t.run(async ctx => {
    const ownerId = f.a.userId as Id<"users">;
    await ctx.db.insert("discoveryScanRuns", { ownerId, profileVersion: 1, trigger: "manual", status: "queued", queuedAt: Date.now(),
      feedsSucceeded: 0, feedsFailed: 0, discovered: 0, reviewable: 0, rejected: 0 });
    await ctx.db.insert("aiOwnerMonths", { ownerId, month: "2026-10", attempts: 1 });
    await ctx.db.insert("aiBudgetAttempts", { ownerId, requestId, month: "2026-10", ...price,
      reservedMicroUsd: 9200, state: "settled", billedMicroUsd: 0, createdAt: Date.now() });
    // The boundaries are intentionally pinned to the documented public contract.
    expect(ACCOUNT_EXPORT_LIMITS).toEqual({ jobs: 200, discoveredJobs: 200, matchDecisions: 1000, reviewerOverrides: 1000,
      statusHistory: 1000, targetProfiles: 1, scanRuns: 30, resumeBundles: 50, hostedRequests: 500,
      pilotOwners: 1, ownerMonths: 120, budgetAttempts: 500, privacyEvents: 1000, invites: 1, enrollmentAuditEvents: 1000 });
    const queries = ownedAccountData(ctx, ownerId);
    for (const key of Object.keys(queries) as (keyof typeof queries)[]) {
      const rows = await queries[key].take(1001);
      expect(rows.length, key).toBeGreaterThan(0);
      const { _id, _creationTime, ...fields } = rows[0];
      const requests = key === "budgetAttempts" ? await ownedAccountData(ctx, ownerId).hostedRequests.take(500) : [];
      for (let i = rows.length; i < ACCOUNT_EXPORT_LIMITS[key]; i++) {
        const value = key === "budgetAttempts" ? { ...fields,
          requestId: requests[i]._id } : fields;
        await ctx.db.insert(categoryTables[key], value as never);
      }
    }
    const invite = (await ownedAccountData(ctx, ownerId).invites.take(1))[0];
    const audits = await ctx.db.query("enrollmentAuditEvents").withIndex("by_invite", q => q.eq("inviteId", invite._id)).collect();
    for (let i = audits.length; i < 1000; i++) await ctx.db.insert("enrollmentAuditEvents", { inviteId: invite._id, event: "inviteAccepted", occurredAt: Date.now() });
    // Preserve history whose parent no longer exists as an independent export.
    const parent = (await ctx.db.get(discovered))!;
    const { _id, _creationTime, ...posting } = parent;
    await ctx.db.insert("discoveredJobs", posting);
    await ctx.db.delete(discovered);
  });
}

const categoryTables = {
  jobs: "jobs", discoveredJobs: "discoveredJobs", matchDecisions: "discoveryMatchDecisions", reviewerOverrides: "discoveryReviewerOverrides",
  statusHistory: "discoveryStatusHistory", targetProfiles: "targetProfiles", scanRuns: "discoveryScanRuns", resumeBundles: "resumeBundles",
  hostedRequests: "hostedResumeRequests", pilotOwners: "aiPilotOwners", ownerMonths: "aiOwnerMonths", budgetAttempts: "aiBudgetAttempts",
  privacyEvents: "accountPrivacyEvents", invites: "alphaInvites",
} as const;

function counts(data: FunctionReturnType<typeof api.account.exportData>) {
  return { jobs: data.jobs.length, discoveredJobs: data.discovery.length, matchDecisions: data.discoveryHistory.matchDecisions.length,
    reviewerOverrides: data.discoveryHistory.reviewerOverrides.length, statusHistory: data.discoveryHistory.statusHistory.length,
    targetProfiles: Number(data.targetProfile !== null), scanRuns: data.discoveryScanRuns.length, resumeBundles: data.resumeBundles.length,
    hostedRequests: data.hostedResumeRequests.length, pilotOwners: Number(data.aiUsage.pilot !== null), ownerMonths: data.aiUsage.months.length,
    budgetAttempts: data.aiUsage.attempts.length, privacyEvents: data.privacyEvents.length, invites: data.enrollment.length,
    enrollmentAuditEvents: data.enrollmentAuditEvents.length };
}

test("complete boundary export includes orphan history, private billing and pending records only for its owner", async () => {
  const f = await fixture(); await atCapacity(f);
  const data = await f.a.client.query(api.account.exportData, {});
  expect(counts(data)).toEqual(ACCOUNT_EXPORT_LIMITS);
  await f.t.run(async ctx => {
    const owned = ownedAccountData(ctx, f.a.userId as Id<"users">);
    const exports = { jobs: data.jobs, discoveredJobs: data.discovery, matchDecisions: data.discoveryHistory.matchDecisions,
      reviewerOverrides: data.discoveryHistory.reviewerOverrides, statusHistory: data.discoveryHistory.statusHistory,
      scanRuns: data.discoveryScanRuns, resumeBundles: data.resumeBundles, hostedRequests: data.hostedResumeRequests,
      ownerMonths: data.aiUsage.months, budgetAttempts: data.aiUsage.attempts, privacyEvents: data.privacyEvents, invites: data.enrollment };
    for (const key of Object.keys(exports) as (keyof typeof exports)[]) {
      const rows = await owned[key].take(ACCOUNT_EXPORT_LIMITS[key] + 1);
      expect(exports[key].map(row => row.id).sort(), key).toEqual(rows.map(row => row._id).sort());
    }
  });
  const json = JSON.stringify(data);
  for (const secret of [f.b.userId, f.b.authUser._id, f.b.authUser.email, "ownerId", "authId", "tokenHash", "reservationEmailHash", "_creationTime"])
    expect(json).not.toContain(secret);
  expect(data.hostedResumeRequests.every(r => r.status === "pending")).toBe(true);
  expect(data.discoveryHistory.matchDecisions.some(r => !data.discovery.some(j => j.id === r.discoveredJobId))).toBe(true);
  expect((await f.b.client.query(api.account.exportData, {})).jobs.map(r => r.id)).toEqual([f.foreignJob]);
  expect(network).not.toHaveBeenCalled();
});

test("every bounded export category refuses one extra row instead of silently truncating", async () => {
  const f = await fixture(); await atCapacity(f);
  expect(counts(await f.a.client.query(api.account.exportData, {}))).toEqual(ACCOUNT_EXPORT_LIMITS);
  for (const [key, table] of Object.entries(categoryTables)) {
    const extra = await f.t.run(async ctx => {
      const row = (await ownedAccountData(ctx, f.a.userId as Id<"users">)[key as keyof typeof categoryTables].take(1))[0];
      const { _id, _creationTime, ...fields } = row;
      return ctx.db.insert(table, fields as never);
    });
    await expect(f.a.client.query(api.account.exportData, {})).rejects.toThrow(`${key} limit (${ACCOUNT_EXPORT_LIMITS[key as keyof typeof ACCOUNT_EXPORT_LIMITS]})`);
    await f.t.run(ctx => ctx.db.delete(extra));
  }
  const extra = await f.t.run(async ctx => {
    const invite = (await ownedAccountData(ctx, f.a.userId as Id<"users">).invites.take(1))[0];
    return ctx.db.insert("enrollmentAuditEvents", { inviteId: invite._id, event: "inviteAccepted", occurredAt: Date.now() });
  });
  await expect(f.a.client.query(api.account.exportData, {})).rejects.toThrow("enrollmentAuditEvents limit (1000)");
  await f.t.run(ctx => ctx.db.delete(extra));
  expect(counts(await f.a.client.query(api.account.exportData, {}))).toEqual(ACCOUNT_EXPORT_LIMITS);
});

test("bounded deletion drains capacity histories, detaches billing, unlinks invites and preserves the second owner exactly", async () => {
  const f = await fixture(); await atCapacity(f);
  const before = await f.b.client.query(api.account.exportData, {});
  await expect(f.t.mutation(internal.account.cleanupDeleted, { ownerId: f.b.userId as Id<"users"> })).rejects.toThrow("Account still exists");
  await f.t.mutation(internal.auth.onDelete, { doc: f.a.authUser, model: "user" });
  await expect(f.a.client.query(api.account.exportData, {})).rejects.toThrow();
  await f.drain();
  await f.t.mutation(internal.account.cleanupDeleted, { ownerId: f.a.userId as Id<"users"> });
  await f.t.run(async ctx => {
    for (const [key, query] of Object.entries(ownedAccountData(ctx, f.a.userId as Id<"users">))) expect(await query.take(1), key).toEqual([]);
    expect(await ctx.db.get(f.a.userId as Id<"users">)).toBeNull();
    expect(await ctx.db.query("aiBudgetAttempts").collect()).toHaveLength(500);
    const invite = (await ctx.db.query("alphaInvites").collect()).find(r => r.claimedBy !== f.b.userId)!;
    expect(invite.expiredAt).toBe(Date.now());
    expect(invite).not.toHaveProperty("claimedBy"); expect(invite).not.toHaveProperty("reservationId");
    expect(await ctx.db.query("accountPrivacyEvents").withIndex("by_user", q => q.eq("userId", undefined)).collect())
      .toEqual([expect.objectContaining({ action: "accountDeleted" })]);
  });
  expect(await f.b.client.query(api.account.exportData, {})).toEqual(before);
  expect(await f.t.query(internal.aiBudget.summary, {})).toMatchObject({ pilotCount: 1 });
  expect(network).not.toHaveBeenCalled();
});

test.each(["account", "job", "bundle"] as const)("queued %s deletion cancels reserved work without provider dispatch", async boundary => {
  const f = await fixture(); const requestId = await f.a.client.mutation(api.hostedResumes.request, f.input);
  const attemptId = await f.t.mutation(internal.aiBudget.reserve, { requestId });
  if (boundary === "account") await f.t.mutation(internal.auth.onDelete, { doc: f.a.authUser, model: "user" });
  if (boundary === "job") await f.a.client.mutation(api.jobs.remove, { id: f.jobId });
  if (boundary === "bundle") await f.a.client.mutation(api.resumeBundles.remove, { jobId: f.jobId, expectedRevision: 1 });
  await f.drain();
  expect(await f.t.run(ctx => ctx.db.get(requestId))).toBeNull();
  expect(await f.t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ state: "settled", billedMicroUsd: 0 });
  expect(await f.t.query(internal.aiBudget.summary, {})).toMatchObject({ unresolvedMicroUsd: 0, settledMicroUsd: 0 });
  expect(network).not.toHaveBeenCalled();
});

test.each(["account", "job", "bundle"].flatMap(boundary => [true, false].map(knownUsage => ({ boundary, knownUsage }))))(
  "late provider output after $boundary deletion (known usage=$knownUsage) cannot resurrect career data", async ({ boundary, knownUsage }) => {
  const f = await fixture(); const before = await f.b.client.query(api.account.exportData, {});
  let attemptId: Id<"aiBudgetAttempts">;
  network.mockImplementation(async () => {
    const attempt = (await f.t.run(ctx => ctx.db.query("aiBudgetAttempts").collect()))[0]; attemptId = attempt._id;
    expect(attempt.state).toBe("dispatched");
    if (boundary === "account") await f.t.mutation(internal.auth.onDelete, { doc: f.a.authUser, model: "user" });
    if (boundary === "job") await f.a.client.mutation(api.jobs.remove, { id: f.jobId });
    if (boundary === "bundle") {
      await f.a.client.mutation(api.resumeBundles.remove, { jobId: f.jobId, expectedRevision: 1 });
      await f.a.client.mutation(api.resumeBundles.save, { ...f.saved, resume: "Replacement human draft" });
    }
    expect(await f.t.query(internal.aiBudget.summary, {})).toMatchObject({ unresolvedMicroUsd: attempt.reservedMicroUsd });
    expect(await f.t.run(ctx => ctx.db.get(attempt._id))).toMatchObject({ state: "dispatched" });
    if (boundary === "account") expect(await f.t.run(ctx => ctx.db.get(attempt._id))).not.toHaveProperty("ownerId");
    return knownUsage ? response() : Response.json({ model: "glm-4.7", choices: [{ finish_reason: "stop",
      message: { role: "assistant", content: draft } }] });
  });
  const requestId = await f.a.client.mutation(api.hostedResumes.request, f.input);
  await f.drain();
  await f.t.action(internal.hostedResumeWorker.execute, { requestId });
  expect(network).toHaveBeenCalledTimes(1);
  expect(await f.t.run(ctx => ctx.db.get(requestId))).toBeNull();
  if (!knownUsage) {
    expect(await f.t.run(ctx => ctx.db.get(attemptId!))).toMatchObject({ state: "unknown", reservedMicroUsd: 9200 });
    expect(await f.t.query(internal.aiBudget.summary, {})).toMatchObject({ unresolvedMicroUsd: 9200, settledMicroUsd: 0 });
    expect(await f.t.run(ctx => ctx.db.query("aiBudgetControl").unique())).toMatchObject({ activeAttemptId: attemptId! });
    await f.t.mutation(internal.aiBudget.settle, { attemptId: attemptId!, billedMicroUsd: 1420 });
  }
  expect(await f.t.run(ctx => ctx.db.get(attemptId!))).toMatchObject({ state: "settled", billedMicroUsd: 1420 });
  expect(await f.t.query(internal.aiBudget.summary, {})).toMatchObject({ unresolvedMicroUsd: 0, settledMicroUsd: 1420 });
  if (boundary === "bundle") expect(await f.a.client.query(api.resumeBundles.get, { jobId: f.jobId }))
    .toMatchObject({ resume: "Replacement human draft", revision: 1, reviewedAt: expect.any(Number) });
  else expect(await f.t.run(ctx => ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", f.a.userId as Id<"users">)).collect())).toEqual([]);
  expect(await f.b.client.query(api.account.exportData, {})).toEqual(before);
});


test("foreign role/request IDs cannot export evidence or trigger cleanup", async () => {
  const f = await fixture();
  const before = await f.a.client.query(api.account.exportData, {});
  const requestId = await f.a.client.mutation(api.hostedResumes.request, f.input);
  await expect(f.b.client.query(api.hostedResumes.status, { requestId })).resolves.toBeNull();
  await expect(f.b.client.mutation(api.jobs.remove, { id: f.jobId })).rejects.toThrow("Job not found");
  await expect(f.b.client.mutation(api.resumeBundles.remove, { jobId: f.jobId, expectedRevision: 1 })).rejects.toThrow("Job not found");
  await expect(f.b.client.query(api.account.exportData, { ownerId: f.a.userId } as any)).rejects.toThrow();
  expect((await f.a.client.query(api.account.exportData, {})).resumeBundles).toEqual(before.resumeBundles.map(r => ({ ...r, reviewedAt: null })));
  expect((await f.b.client.query(api.account.exportData, {})).hostedResumeRequests).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});


test("old bundle cleanup continuations preserve a replacement bundle and its new intent", async () => {
  const f = await fixture();
  const oldRequest = await f.a.client.mutation(api.hostedResumes.request, f.input);
  const oldBundleId = (await f.t.run(ctx => ctx.db.get(oldRequest)))!.bundleId;
  await f.t.run(async ctx => {
    const { _id, _creationTime, ...fields } = (await ctx.db.get(oldRequest))!;
    for (let i = 0; i < 25; i++) await ctx.db.insert("hostedResumeRequests", { ...fields, status: "failed", failureCode: "providerFailed" });
  });
  await f.a.client.mutation(api.resumeBundles.remove, { jobId: f.jobId, expectedRevision: 1 });
  await f.a.client.mutation(api.resumeBundles.save, { ...f.saved, resume: "Replacement human draft" });
  const newRequest = await f.a.client.mutation(api.hostedResumes.request, f.input);
  // Replay the actual internal continuation before the new provider delivery.
  for (let i = 0; i < 3; i++) await f.t.mutation(internal.account.cleanupRole, {
    ownerId: f.a.userId as Id<"users">, jobId: f.jobId, bundleId: oldBundleId,
  });
  expect(await f.t.run(ctx => ctx.db.query("hostedResumeRequests").withIndex("by_owner_bundle", q =>
    q.eq("ownerId", f.a.userId as Id<"users">).eq("bundleId", oldBundleId)).collect())).toEqual([]);
  expect(await f.a.client.query(api.hostedResumes.status, { requestId: newRequest })).toMatchObject({ status: "pending" });
  expect(await f.a.client.query(api.resumeBundles.get, { jobId: f.jobId })).toMatchObject({ resume: "Replacement human draft", revision: 1 });
  await f.drain();
  expect(network).toHaveBeenCalledTimes(1);
  expect(await f.a.client.query(api.hostedResumes.status, { requestId: newRequest })).toMatchObject({ status: "succeeded" });
});
