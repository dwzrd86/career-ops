import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireVerifiedUser } from "./auth";
import { requireEnrolledUser } from "./enrollment";
import { requireCurrentPrivacyAcknowledgement, PRIVACY_POLICY_VERSION } from "./privacy";
import { targetProfileFields } from "./targetProfileModel";

const MIN_SCAN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const MAX_FEED_JOBS = 15;
const jobMetadata = v.object({
  localJobId: v.string(),
  company: v.string(),
  title: v.string(),
  location: v.optional(v.string()),
  url: v.string(),
  source: v.object({ label: v.string(), provider: v.union(v.literal("greenhouse"), v.literal("ashby"), v.literal("lever")) }),
  postedAt: v.optional(v.number()),
  postingText: v.optional(v.string()),
  decision: v.object({
    outcome: v.union(v.literal("ranked"), v.literal("needsReview")),
    score: v.number(),
    hardFilters: v.array(v.object({ ruleId: v.string(), outcome: v.union(v.literal("pass"), v.literal("fail"), v.literal("unknown"), v.literal("notApplicable")), reasonCode: v.string() })),
    explanationCodes: v.array(v.string()),
  }),
});

async function queueRun(ctx: MutationCtx, profile: Doc<"targetProfiles">, trigger: "manual" | "scheduled") {
  const now = Date.now();
  const recent = await ctx.db.query("discoveryScanRuns")
    .withIndex("by_owner_queued_at", (query) => query.eq("ownerId", profile.ownerId))
    .order("desc").first();
  if (recent && (recent.status === "queued" || recent.status === "running") && now - recent.queuedAt < 30 * 60_000) return recent._id;
  const runId = await ctx.db.insert("discoveryScanRuns", {
    ownerId: profile.ownerId,
    profileVersion: profile.profileVersion,
    trigger,
    status: "queued",
    queuedAt: now,
    feedsSucceeded: 0,
    feedsFailed: 0,
    discovered: 0,
    reviewable: 0,
    rejected: 0,
  });
  await ctx.db.patch(profile._id, { lastScanAt: now });
  await ctx.scheduler.runAfter(0, internal.autoDiscoveryWorker.runForOwner, { runId });
  const history = await ctx.db.query("discoveryScanRuns")
    .withIndex("by_owner_queued_at", (query) => query.eq("ownerId", profile.ownerId))
    .order("desc").take(31);
  if (history.length > 30) await ctx.db.delete(history[30]._id);
  return runId;
}

export const requestScan = mutation({
  args: {},
  returns: v.id("discoveryScanRuns"),
  handler: async (ctx) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
    const profile = await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", ownerId)).unique();
    if (!profile?.enabled) throw new Error("Save and enable your Target Profile before scanning");
    return await queueRun(ctx, profile, "manual");
  },
});

export const listRuns = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("discoveryScanRuns"),
    _creationTime: v.number(),
    profileVersion: v.number(),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("partial"), v.literal("failed")),
    queuedAt: v.number(),
    finishedAt: v.optional(v.number()),
    feedsSucceeded: v.number(),
    feedsFailed: v.number(),
    discovered: v.number(),
    reviewable: v.number(),
    rejected: v.number(),
    errorCode: v.optional(v.string()),
  })),
  handler: async (ctx) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const runs = await ctx.db.query("discoveryScanRuns").withIndex("by_owner_queued_at", (query) => query.eq("ownerId", ownerId)).order("desc").take(20);
    return runs.map(({ ownerId: _ownerId, ...run }) => run);
  },
});

export const queueDueRuns = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const weekday = new Date(now).getUTCDay();
    const profiles = await ctx.db.query("targetProfiles").withIndex("by_enabled", (query) => query.eq("enabled", true)).take(50);
    let queued = 0;
    for (const profile of profiles) {
      if (profile.schedule === "manual" || (profile.schedule === "weekdays" && (weekday === 0 || weekday === 6))) continue;
      if (profile.lastScanAt && now - profile.lastScanAt < MIN_SCAN_INTERVAL_MS) continue;
      const user = await ctx.db.get(profile.ownerId);
      if (user?.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || user.privacyAcknowledgedAt === undefined) continue;
      const invite = await ctx.db.query("alphaInvites").withIndex("by_claimed_by", (query) => query.eq("claimedBy", profile.ownerId)).unique();
      if (!invite || invite.expiredAt !== undefined) continue;
      await queueRun(ctx, profile, "scheduled");
      queued++;
    }
    return queued;
  },
});

// Claim and validate in one transaction. A duplicate invocation must leave the
// winning worker alone, including its final status and counters.
export const claimRun = internalMutation({
  args: { runId: v.id("discoveryScanRuns") },
  returns: v.union(v.null(), v.object({
    _id: v.id("targetProfiles"), _creationTime: v.number(), ownerId: v.id("users"),
    ...targetProfileFields, profileVersion: v.number(), updatedAt: v.number(), lastScanAt: v.optional(v.number()),
  })),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    const profile = await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", run.ownerId)).unique();
    let errorCode: string | undefined;
    if (!profile?.enabled || profile.profileVersion !== run.profileVersion) errorCode = "PROFILE_CHANGED";
    else {
      try {
        await requireEnrolledUser(ctx, run.ownerId);
        await requireCurrentPrivacyAcknowledgement(ctx, run.ownerId);
      } catch { errorCode = "ACCOUNT_ACCESS_CHANGED"; }
    }
    if (errorCode) {
      await ctx.db.patch(runId, { status: "failed", finishedAt: Date.now(), errorCode });
      return null;
    }
    await ctx.db.patch(runId, { status: "running" });
    return profile;
  },
});

export const ingestBatch = internalMutation({
  args: { runId: v.id("discoveryScanRuns"), profileVersion: v.number(), jobs: v.array(jobMetadata) },
  returns: v.number(),
  handler: async (ctx, { runId, profileVersion, jobs }) => {
    if (jobs.length > MAX_FEED_JOBS) throw new Error("Batch exceeds scan limit");
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running" || run.profileVersion !== profileVersion) throw new Error("Scan run is no longer active");
    const profile = await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", run.ownerId)).unique();
    if (!profile?.enabled || profile.profileVersion !== profileVersion) throw new Error("Target Profile changed during scan");
    await requireEnrolledUser(ctx, run.ownerId);
    await requireCurrentPrivacyAcknowledgement(ctx, run.ownerId);
    if (jobs.some(item => item.postingText !== undefined && item.postingText.length > 30_000)) throw new Error("Posting exceeds 30000 characters");
    let added = 0;
    for (const item of jobs) {
      if (item.company.length > 160 || item.title.length > 200 || item.url.length > 2048 || item.localJobId.length > 128) continue;
      const existingById = await ctx.db.query("discoveredJobs").withIndex("by_owner_local_job", (query) => query.eq("ownerId", run.ownerId).eq("localJobId", item.localJobId)).unique();
      const existingByUrl = existingById ?? await ctx.db.query("discoveredJobs").withIndex("by_owner_url", (query) => query.eq("ownerId", run.ownerId).eq("url", item.url)).first();
      const now = Date.now();
      const patch = {
        company: item.company,
        title: item.title,
        location: item.location,
        url: item.url,
        source: item.source,
        // Omitted text in a later feed must not erase previously captured evidence.
        ...(item.postingText?.trim() ? { postingText: item.postingText.trim() } : {}),
        freshness: { checkedAt: now, postedAt: item.postedAt, status: "fresh" as const },
        updatedAt: now,
      };
      const jobId = existingByUrl ? existingByUrl._id : await ctx.db.insert("discoveredJobs", {
        ...patch, ownerId: run.ownerId, localJobId: item.localJobId, discoveredAt: now, reviewStatus: "discovered",
      });
      if (existingByUrl) await ctx.db.patch(jobId, patch);
      else {
        added++;
        await ctx.db.insert("discoveryStatusHistory", { ownerId: run.ownerId, discoveredJobId: jobId, status: "discovered", occurredAt: now });
      }
      const previous = await ctx.db.query("discoveryMatchDecisions")
        .withIndex("by_owner_job_decided_at", (query) => query.eq("ownerId", run.ownerId).eq("discoveredJobId", jobId))
        .order("desc").first();
      if (previous?.profileVersion === profileVersion && previous.outcome === item.decision.outcome && previous.score === item.decision.score && JSON.stringify(previous.hardFilters) === JSON.stringify(item.decision.hardFilters)) continue;
      await ctx.db.insert("discoveryMatchDecisions", {
        ownerId: run.ownerId,
        discoveredJobId: jobId,
        profileVersion,
        outcome: item.decision.outcome,
        score: item.decision.score,
        hardFilters: item.decision.hardFilters,
        explanationCodes: item.decision.explanationCodes,
        decidedAt: now,
      });
    }
    return added;
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("discoveryScanRuns"),
    status: v.union(v.literal("succeeded"), v.literal("partial"), v.literal("failed")),
    feedsSucceeded: v.number(), feedsFailed: v.number(), discovered: v.number(), reviewable: v.number(), rejected: v.number(),
    errorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || (run.status !== "running" && run.status !== "queued")) return null;
    const { runId, ...result } = args;
    await ctx.db.patch(runId, { ...result, finishedAt: Date.now() });
    return null;
  },
});
