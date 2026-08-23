import { mutationGeneric, queryGeneric } from "convex/server";
import { requireVerifiedUser } from "./auth";

function groupByDiscoveredJob(records: any[]) {
  return records.reduce((grouped, record) => {
    const recordsForJob = grouped.get(record.discoveredJobId) ?? [];
    recordsForJob.push(record);
    grouped.set(record.discoveredJobId, recordsForJob);
    return grouped;
  }, new Map<any, any[]>());
}

function withoutOwnership(record: any) {
  const { _creationTime: _creationTime, _id, discoveredJobId: _discoveredJobId, ownerId: _ownerId, ...metadata } = record;
  return { id: _id, ...metadata };
}

export const exportData = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const [jobs, discoveredJobs, matchDecisions, reviewerOverrides, statusHistory] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_owner_created_at", (query) => query.eq("ownerId", userId))
        .order("desc")
        .collect(),
      ctx.db
        .query("discoveredJobs")
        .withIndex("by_owner_discovered_at", (query) => query.eq("ownerId", userId))
        .order("desc")
        .collect(),
      ctx.db
        .query("discoveryMatchDecisions")
        .withIndex("by_owner_job_decided_at", (query) => query.eq("ownerId", userId))
        .order("desc")
        .collect(),
      ctx.db
        .query("discoveryReviewerOverrides")
        .withIndex("by_owner_job_overridden_at", (query) => query.eq("ownerId", userId))
        .order("desc")
        .collect(),
      ctx.db
        .query("discoveryStatusHistory")
        .withIndex("by_owner_job_occurred_at", (query) => query.eq("ownerId", userId))
        .order("desc")
        .collect(),
    ]);
    const decisionsByJob = groupByDiscoveredJob(matchDecisions);
    const overridesByJob = groupByDiscoveredJob(reviewerOverrides);
    const statusesByJob = groupByDiscoveredJob(statusHistory);
    const user = await ctx.db.get(userId);
    return {
      exportedAt: new Date().toISOString(),
      format: "jobbie-account-export-v2",
      jobs: jobs.map(withoutOwnership),
      discovery: discoveredJobs.map((job) => ({
        ...withoutOwnership(job),
        matchDecisions: (decisionsByJob.get(job._id) ?? []).map(withoutOwnership),
        reviewerOverrides: (overridesByJob.get(job._id) ?? []).map(withoutOwnership),
        statusHistory: (statusesByJob.get(job._id) ?? []).map(withoutOwnership),
      })),
      privacy: user?.privacyAcknowledgedAt === undefined ? null : {
        acknowledgedAt: new Date(user.privacyAcknowledgedAt).toISOString(),
        policyVersion: user.privacyPolicyVersion ?? null,
      },
    };
  },
});

export const recordExportRequest = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    await ctx.db.insert("accountPrivacyEvents", { action: "exportRequested", occurredAt: Date.now(), userId });
  },
});
