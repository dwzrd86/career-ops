import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { HOSTED_CONSENT_VERSION } from "./hostedResumes";
import { PRIVACY_POLICY_VERSION } from "./privacy";

const modules = import.meta.glob("./**/*.ts");
type Deployment = ReturnType<typeof fixture>;
function fixture() { return convexTest(schema, modules); }
const price = {
  provider: "zai", model: "glm-4.7", inputMicroUsdPerMillion: 600_000,
  outputMicroUsdPerMillion: 2_200_000, maxInputTokens: 6_000, maxTotalOutputTokens: 2_000,
  evidence: "fictional-test-bounds-v1", validUntil: Date.UTC(2027, 0, 1),
}; // $0.008 maximum. This is synthetic evidence, never live authorization.
async function setup(t: Deployment, maximum = 8_000_000) {
  await t.mutation(internal.aiBudget.configure, { enabled: true, cutoffMicroUsd: maximum });
  await t.mutation(internal.aiBudget.approvePrice, price);
}
async function owner(t: Deployment, label = "fictional") {
  const id = await t.run(async ctx => {
    const id = await ctx.db.insert("users", { authId: label, privacyAcknowledgedAt: Date.now(), privacyPolicyVersion: PRIVACY_POLICY_VERSION });
    await ctx.db.insert("alphaInvites", { claimedBy: id, createdAt: Date.now(), expiresAt: Date.now() + 1_000, tokenHash: label });
    return id;
  });
  await t.mutation(internal.aiBudget.setPilotOwner, { ownerId: id, active: true });
  return id;
}
async function request(t: Deployment, ownerId: Id<"users">) {
  return await t.run(async ctx => {
    const jobId = await ctx.db.insert("jobs", { ownerId, company: "Fictional Co", title: "Engineer", location: "Remote",
      url: "https://jobs.example.test/fictional", source: "manual", status: "discovered", createdAt: Date.now(), updatedAt: Date.now() });
    const bundleId = await ctx.db.insert("resumeBundles", { ownerId, jobId, sourceResume: "Fictional SQL experience",
      description: "Fictional SQL role", resume: "Existing reviewed text", revision: 1, reviewedAt: Date.now(), updatedAt: Date.now() });
    return await ctx.db.insert("hostedResumeRequests", { ownerId, jobId, bundleId, bundleRevision: 1,
      company: "Fictional Co", title: "Engineer", provider: "zai", model: "glm-4.7", consentVersion: HOSTED_CONSENT_VERSION,
      consentedAt: Date.now(), privacyPolicyVersion: PRIVACY_POLICY_VERSION, status: "pending", createdAt: Date.now() });
  });
}
const reserve = (t: Deployment, requestId: Id<"hostedResumeRequests">) => t.mutation(internal.aiBudget.reserve, { requestId });
const claim = (t: Deployment, attemptId: Id<"aiBudgetAttempts">) => t.mutation(internal.aiBudget.claimDispatch, { attemptId });
const settle = (t: Deployment, attemptId: Id<"aiBudgetAttempts">, billedMicroUsd: number | null) => t.mutation(internal.aiBudget.settle, { attemptId, billedMicroUsd });
const summary = (t: Deployment) => t.query(internal.aiBudget.summary, {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
  vi.stubEnv("HOSTED_AI_EXECUTION_ENABLED", "true");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("durable hosted AI admission (fictional data, no provider/network)", () => {
  test("unconfigured/disabled, unpriced and expired models fail closed without quota/budget writes", async () => {
    const t = fixture();
    await t.mutation(internal.aiBudget.configure, { enabled: false, cutoffMicroUsd: 8_000_000 });
    const a = await owner(t), r = await request(t, a);
    await expect(reserve(t, r)).rejects.toThrow("disabled");
    await t.mutation(internal.aiBudget.configure, { enabled: true, cutoffMicroUsd: 8_000_000 });
    await expect(reserve(t, r)).rejects.toThrow("ceiling unavailable");
    await t.mutation(internal.aiBudget.approvePrice, { ...price, validUntil: Date.now() + 1 });
    vi.advanceTimersByTime(2);
    await expect(reserve(t, r)).rejects.toThrow("ceiling unavailable");
    expect(await t.run(ctx => ctx.db.query("aiBudgetAttempts").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("aiOwnerMonths").collect())).toHaveLength(0);
  });

  test("only integer priced bounds and a cutoff at/below $8 can be configured", async () => {
    const t = fixture();
    for (const cutoffMicroUsd of [8_000_001, 0, -1, 1.1, NaN]) {
      await expect(t.mutation(internal.aiBudget.configure, { enabled: true, cutoffMicroUsd })).rejects.toThrow();
    }
    for (const invalid of [{ inputMicroUsdPerMillion: 0 }, { outputMicroUsdPerMillion: -1 },
      { maxInputTokens: 1.5 }, { maxTotalOutputTokens: 0 }, { evidence: "" }, { model: "unknown" }, { provider: "unknown" }]) {
      await expect(t.mutation(internal.aiBudget.approvePrice, { ...price, ...invalid })).rejects.toThrow();
    }
    await setup(t);
    await t.mutation(internal.aiBudget.approvePrice, { ...price, inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1, maxInputTokens: 1, maxTotalOutputTokens: 1 });
    const id = await reserve(t, await request(t, await owner(t)));
    expect((await t.run(ctx => ctx.db.get(id)))!.reservedMicroUsd).toBe(1); // rounds UP
  });

  test("same request is idempotent; owner and global dispatch gates prevent duplicate fake calls", async () => {
    const t = fixture(); await setup(t);
    const a = await owner(t, "a"), b = await owner(t, "b");
    const r = await request(t, a);
    const ids = await Promise.all([reserve(t, r), reserve(t, r)]);
    expect(ids[0]).toBe(ids[1]);
    await expect(reserve(t, await request(t, a))).rejects.toThrow("One active");
    const second = await reserve(t, await request(t, b));
    const provider = vi.fn();
    async function worker(id: Id<"aiBudgetAttempts">) { const permit = await claim(t, id); if (permit) provider(permit); }
    await Promise.all([worker(ids[0]), worker(ids[0])]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ model: "glm-4.7", maxTotalOutputTokens: 2000 }));
    await expect(worker(second)).rejects.toThrow("One global");
    // New worker invocation has no memory, but persisted claim still refuses replay.
    await worker(ids[0]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 16_000 });
  });

  test("simultaneous admissions share the exact cutoff with no quota writes for rejected work", async () => {
    const t = fixture(); await setup(t, 8_000);
    const a = await owner(t, "a"), b = await owner(t, "b");
    const ra = await request(t, a), rb = await request(t, b);
    const results = await Promise.allSettled([reserve(t, ra), reserve(t, rb)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 8_000 });
    expect(await t.run(ctx => ctx.db.query("aiOwnerMonths").collect())).toHaveLength(1);
  });

  test("the actual $8 shared ceiling admits two $4 reservations and refuses the third", async () => {
    const t = fixture(); await setup(t);
    await t.mutation(internal.aiBudget.approvePrice, { ...price,
      inputMicroUsdPerMillion: 500_000_000, outputMicroUsdPerMillion: 500_000_000 });
    const owners = [await owner(t, "a"), await owner(t, "b"), await owner(t, "c")];
    const requests = await Promise.all(owners.map(a => request(t, a)));
    const results = await Promise.allSettled(requests.map(r => reserve(t, r)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 8_000_000, warning: 7 });
  });

  test("20 attempts includes failed, regenerated, retry and release-check attempts; UTC resets quota only", async () => {
    const t = fixture(); await setup(t);
    const a = await owner(t);
    for (let i = 0; i < 20; i++) {
      const id = await reserve(t, await request(t, a));
      await claim(t, id);
      await settle(t, id, 8_000);
    }
    await expect(reserve(t, await request(t, a))).rejects.toThrow("quota exhausted");
    expect(await summary(t)).toMatchObject({ settledMicroUsd: 160_000 });
    vi.setSystemTime(Date.UTC(2026, 10, 1));
    await expect(reserve(t, await request(t, a))).resolves.toBeTruthy();
    expect(await t.run(ctx => ctx.db.query("aiOwnerMonths").collect())).toEqual(expect.arrayContaining([
      expect.objectContaining({ month: "2026-10", attempts: 20 }), expect.objectContaining({ month: "2026-11", attempts: 1 }),
    ]));
  });

  test("timeout reservations survive worker restart/month rollover; late billing belongs to original month", async () => {
    const t = fixture(); await setup(t, 8_000);
    const a = await owner(t, "a"), b = await owner(t, "b");
    vi.setSystemTime(Date.UTC(2026, 9, 31, 23, 59, 59));
    const id = await reserve(t, await request(t, a)); await claim(t, id);
    await settle(t, id, null);
    vi.setSystemTime(Date.UTC(2026, 10, 1));
    expect(await claim(t, id)).toBeNull();
    expect(await summary(t)).toMatchObject({ settledMicroUsd: 0, unresolvedMicroUsd: 8_000 });
    await expect(reserve(t, await request(t, b))).rejects.toThrow("budget exhausted");
    await expect(reserve(t, await request(t, a))).rejects.toThrow("One active");
    await settle(t, id, 6_000);
    expect(await t.run(ctx => ctx.db.query("aiBudgetMonths").withIndex("by_month", q => q.eq("month", "2026-10")).unique()))
      .toMatchObject({ settledMicroUsd: 6_000, reservedMicroUsd: 0 });
    expect(await summary(t)).toMatchObject({ settledMicroUsd: 0, unresolvedMicroUsd: 0 });
    await expect(reserve(t, await request(t, b))).resolves.toBeTruthy();
  });

  test("unknown usage, browser failure and owner deletion cannot refund; billing can settle after deletion", async () => {
    const t = fixture(); await setup(t);
    const a = await owner(t), r = await request(t, a);
    const id = await reserve(t, r); await claim(t, id);
    await t.mutation(internal.hostedResumes.fail, { requestId: r, code: "providerFailed" });
    await t.run(ctx => ctx.db.delete(a));
    await settle(t, id, null);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 8_000 });
    await settle(t, id, 5_000);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 0, settledMicroUsd: 5_000 });
  });

  test("settlement is idempotent, rejects conflicting/noninteger bills, and freezes on unexpected overrun", async () => {
    const t = fixture(); await setup(t);
    const id = await reserve(t, await request(t, await owner(t))); await claim(t, id);
    for (const bill of [-1, 0.5, NaN]) await expect(settle(t, id, bill)).rejects.toThrow();
    expect(await settle(t, id, 9_000)).toBe(true);
    expect(await settle(t, id, 9_000)).toBe(false);
    expect(await settle(t, id, null)).toBe(false);
    await expect(settle(t, id, 8_000)).rejects.toThrow("Conflicting");
    expect(await summary(t)).toMatchObject({ enabled: false, settledMicroUsd: 9_000, unresolvedMicroUsd: 0 });
  });

  test("kill switches stop admission AND previously reserved dispatch without dropping reservations", async () => {
    const t = fixture(); await setup(t);
    const a = await owner(t), id = await reserve(t, await request(t, a));
    vi.stubEnv("HOSTED_AI_EXECUTION_ENABLED", "false");
    await expect(claim(t, id)).rejects.toThrow("disabled");
    vi.stubEnv("HOSTED_AI_EXECUTION_ENABLED", "true");
    await t.mutation(internal.aiBudget.configure, { enabled: false, cutoffMicroUsd: 8_000_000 });
    await expect(claim(t, id)).rejects.toThrow("disabled");
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 8_000 });
    // Operator may release only a provably never-claimed reservation at zero;
    // the attempt quota stays consumed. There is no public cancel/refund API.
    await expect(settle(t, id, 1)).rejects.toThrow("not dispatched");
    await settle(t, id, 0);
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 0 });
    expect(await t.run(ctx => ctx.db.query("aiOwnerMonths").unique())).toMatchObject({ attempts: 1 });
  });

  test("changed pricing, expired proof and tighter cutoff stop previously admitted dispatch", async () => {
    for (const change of ["price", "expiry", "cutoff"] as const) {
      const t = fixture(); await setup(t);
      const id = await reserve(t, await request(t, await owner(t)));
      if (change === "price") await t.mutation(internal.aiBudget.approvePrice, { ...price, outputMicroUsdPerMillion: 3_000_000 });
      if (change === "expiry") vi.setSystemTime(price.validUntil);
      if (change === "cutoff") await t.mutation(internal.aiBudget.configure, { enabled: true, cutoffMicroUsd: 7_999 });
      await expect(claim(t, id)).rejects.toThrow();
      expect((await t.run(ctx => ctx.db.get(id)))!.state).toBe("reserved");
      vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
    }
  });

  test("five pilot slots count synthetic accounts too; release is explicit and never erases their charges/quota", async () => {
    const t = fixture(); await setup(t);
    const owners = [];
    for (let i = 0; i < 5; i++) owners.push(await owner(t, `test-${i}`));
    await expect(owner(t, "sixth")).rejects.toThrow("capacity");
    const id = await reserve(t, await request(t, owners[0]));
    await expect(t.mutation(internal.aiBudget.setPilotOwner, { ownerId: owners[0], active: false })).rejects.toThrow("Unresolved");
    await claim(t, id); await settle(t, id, 8_000);
    await t.mutation(internal.aiBudget.setPilotOwner, { ownerId: owners[0], active: false });
    await owner(t, "replacement");
    expect(await summary(t)).toMatchObject({ pilotCount: 5, settledMicroUsd: 8_000 });
    expect(await t.run(ctx => ctx.db.query("aiPilotOwners").withIndex("by_owner", q => q.eq("ownerId", owners[0])).unique())).toMatchObject({ active: false });
    await expect(reserve(t, await request(t, owners[0]))).rejects.toThrow("pilot admission");
  });

  test.each(["privacy", "invite", "bundle", "consent"])("access/evidence is rechecked before dispatch: %s", async kind => {
    const t = fixture(); await setup(t);
    const a = await owner(t), r = await request(t, a);
    const id = await reserve(t, r);
    await t.run(async ctx => {
      const item = (await ctx.db.get(r))!;
      if (kind === "privacy") await ctx.db.patch(a, { privacyPolicyVersion: "old" });
      if (kind === "bundle") await ctx.db.patch(item.bundleId, { revision: 2 });
      if (kind === "consent") await ctx.db.patch(r, { consentVersion: "old" });
      if (kind === "invite") {
        const invitation = (await ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", a)).unique())!;
        await ctx.db.patch(invitation._id, { expiredAt: Date.now() });
      }
    });
    await expect(claim(t, id)).rejects.toThrow();
    expect(await summary(t)).toMatchObject({ unresolvedMicroUsd: 8_000 });
    expect((await t.run(ctx => ctx.db.get(id)))!.state).toBe("reserved");
  });

  test("warning levels reflect settled plus reserved exposure; provider policies never create separate pools", async () => {
    const t = fixture(); await setup(t);
    await t.mutation(internal.aiBudget.approvePrice, { ...price, inputMicroUsdPerMillion: 500_000_000, outputMicroUsdPerMillion: 1_000_000_000 }); // $5
    const a = await owner(t, "a"), b = await owner(t, "b"), c = await owner(t, "c");
    const first = await reserve(t, await request(t, a));
    expect(await summary(t)).toMatchObject({ warning: 5 });
    await claim(t, first); await settle(t, first, 5_000_000);
    await t.mutation(internal.aiBudget.approvePrice, { ...price, inputMicroUsdPerMillion: 100_000_000, outputMicroUsdPerMillion: 700_000_000 }); // $2
    await reserve(t, await request(t, b));
    expect(await summary(t)).toMatchObject({ warning: 7, settledMicroUsd: 5_000_000, unresolvedMicroUsd: 2_000_000 });
    await t.mutation(internal.aiBudget.approvePrice, { ...price, provider: "anthropic", model: "claude-sonnet-4-6" });
    // Adding the conditional provider's price cannot reset the existing pool.
    // Public consent is still pinned to Z.ai; enabling Claude requires the later
    // explicit provider-choice implementation, never a ledger fallback.
    const r = await request(t, c);
    await t.mutation(internal.aiBudget.approvePrice, { ...price, inputMicroUsdPerMillion: 500_000_000, outputMicroUsdPerMillion: 1_000_000_000 });
    await expect(reserve(t, r)).rejects.toThrow("budget exhausted");
  });
});
