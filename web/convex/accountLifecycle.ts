import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// Shared schema inventory for export and deletion. Each read is owner-indexed.
export function ownedAccountData(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">) {
  return {
    jobs: ctx.db.query("jobs").withIndex("by_owner_created_at", q => q.eq("ownerId", ownerId)).order("desc"),
    discoveredJobs: ctx.db.query("discoveredJobs").withIndex("by_owner_discovered_at", q => q.eq("ownerId", ownerId)).order("desc"),
    matchDecisions: ctx.db.query("discoveryMatchDecisions").withIndex("by_owner_job_decided_at", q => q.eq("ownerId", ownerId)).order("desc"),
    reviewerOverrides: ctx.db.query("discoveryReviewerOverrides").withIndex("by_owner_job_overridden_at", q => q.eq("ownerId", ownerId)).order("desc"),
    statusHistory: ctx.db.query("discoveryStatusHistory").withIndex("by_owner_job_occurred_at", q => q.eq("ownerId", ownerId)).order("desc"),
    targetProfiles: ctx.db.query("targetProfiles").withIndex("by_owner", q => q.eq("ownerId", ownerId)),
    scanRuns: ctx.db.query("discoveryScanRuns").withIndex("by_owner_queued_at", q => q.eq("ownerId", ownerId)).order("desc"),
    resumeBundles: ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", ownerId)),
    hostedRequests: ctx.db.query("hostedResumeRequests").withIndex("by_owner_status", q => q.eq("ownerId", ownerId)),
    pilotOwners: ctx.db.query("aiPilotOwners").withIndex("by_owner", q => q.eq("ownerId", ownerId)),
    ownerMonths: ctx.db.query("aiOwnerMonths").withIndex("by_owner_month", q => q.eq("ownerId", ownerId)),
    budgetAttempts: ctx.db.query("aiBudgetAttempts").withIndex("by_owner", q => q.eq("ownerId", ownerId)),
    privacyEvents: ctx.db.query("accountPrivacyEvents").withIndex("by_user", q => q.eq("userId", ownerId)),
    invites: ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", ownerId)),
  };
}

const CLEANUP_BATCH = 10;

// Deleting a request never refunds a possibly dispatched call. The attempt is
// retained for the worker's late usage settlement and duplicate-delivery guard.
async function removeRequest(ctx: MutationCtx, requestId: Id<"hostedResumeRequests">): Promise<void> {
  const attempt = await ctx.db.query("aiBudgetAttempts").withIndex("by_request", q => q.eq("requestId", requestId)).unique();
  if (attempt?.state === "reserved") {
    await ctx.runMutation(internal.aiBudget.cancelUnclaimed, { attemptId: attempt._id });
  }
  await ctx.db.delete(requestId);
}

// Only called after the public mutation has proved job ownership. Scheduled
// continuations carry that same owner and exact job/bundle identity.
export async function cleanupRoleRequests(ctx: MutationCtx, args: {
  ownerId: Id<"users">; jobId: Id<"jobs">; bundleId?: Id<"resumeBundles">;
}): Promise<void> {
  const requests = args.bundleId
    ? ctx.db.query("hostedResumeRequests").withIndex("by_owner_bundle", q => q.eq("ownerId", args.ownerId).eq("bundleId", args.bundleId!))
    : ctx.db.query("hostedResumeRequests").withIndex("by_owner_job", q => q.eq("ownerId", args.ownerId).eq("jobId", args.jobId));
  const batch = await requests.take(CLEANUP_BATCH);
  for (const item of batch) await removeRequest(ctx, item._id);
  if (batch.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.account.cleanupRole, args);
}

// The auth trigger removes the app user and revokes enrollment in the same
// transaction as the first batch. Continuations must never act on a live owner.
export async function cleanupDeletedAccount(ctx: MutationCtx, ownerId: Id<"users">): Promise<void> {
  if (await ctx.db.get(ownerId)) throw new Error("Account still exists");
  const queries = ownedAccountData(ctx, ownerId);
  let more = false;
  // Requests first: a never-dispatched reservation can be safely settled at 0.
  const requests = await queries.hostedRequests.take(CLEANUP_BATCH);
  for (const item of requests) await removeRequest(ctx, item._id);
  more ||= requests.length === CLEANUP_BATCH;
  const attempts = await queries.budgetAttempts.take(CLEANUP_BATCH);
  for (const item of attempts) {
    if (item.state === "reserved") await ctx.runMutation(internal.aiBudget.cancelUnclaimed, { attemptId: item._id });
    await ctx.db.patch(item._id, { ownerId: undefined });
  }
  more ||= attempts.length === CLEANUP_BATCH;
  const slots = await queries.pilotOwners.take(CLEANUP_BATCH);
  const state = await ctx.db.query("aiBudgetControl").withIndex("by_key", q => q.eq("key", "shared")).unique();
  const released = slots.filter(slot => slot.active).length;
  if (state && released) await ctx.db.patch(state._id, { pilotCount: Math.max(0, state.pilotCount - released) });
  for (const item of slots) await ctx.db.delete(item._id);
  more ||= slots.length === CLEANUP_BATCH;
  const invites = await queries.invites.take(CLEANUP_BATCH);
  for (const item of invites) await ctx.db.patch(item._id, {
    claimedBy: undefined, expiredAt: Date.now(), reservationId: undefined,
    reservationEmailHash: undefined, reservationExpiresAt: undefined,
  });
  more ||= invites.length === CLEANUP_BATCH;
  for (const key of ["jobs", "discoveredJobs", "matchDecisions", "reviewerOverrides", "statusHistory",
    "targetProfiles", "scanRuns", "resumeBundles", "ownerMonths", "privacyEvents"] as const) {
    const batch = await queries[key].take(CLEANUP_BATCH);
    for (const item of batch) await ctx.db.delete(item._id);
    more ||= batch.length === CLEANUP_BATCH;
  }
  if (more) await ctx.scheduler.runAfter(0, internal.account.cleanupDeleted, { ownerId });
}
