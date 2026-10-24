import { v, type PropertyValidators } from "convex/values";
import type { TableNames } from "./_generated/dataModel";
import schema from "./schema";
import { requireVerifiedUser } from "./auth";
import { internalMutation, mutation, query } from "./_generated/server";
import { cleanupDeletedAccount, cleanupRoleRequests, ownedAccountData } from "./accountLifecycle";

// Single-response export limits. Probe one extra row and fail rather than
// silently certifying a partial download. Large histories need a private export.
export const ACCOUNT_EXPORT_LIMITS = {
  jobs: 200, discoveredJobs: 200, matchDecisions: 1000, reviewerOverrides: 1000,
  statusHistory: 1000, targetProfiles: 1, scanRuns: 30, resumeBundles: 50,
  hostedRequests: 500, pilotOwners: 1, ownerMonths: 120, budgetAttempts: 500,
  privacyEvents: 1000, invites: 1, enrollmentAuditEvents: 1000,
} as const;

async function completeCategory<T>(query: { take: (n: number) => Promise<T[]> }, key: keyof typeof ACCOUNT_EXPORT_LIMITS): Promise<T[]> {
  const limit = ACCOUNT_EXPORT_LIMITS[key];
  const rows = await query.take(limit + 1);
  if (rows.length > limit) throw new Error(`Account export exceeds ${key} limit (${limit}). Request a complete private data export from your beta host.`);
  return rows;
}
function groupByDiscoveredJob<T extends { discoveredJobId: string }>(records: T[]) {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const entries = grouped.get(record.discoveredJobId) ?? [];
    entries.push(record);
    grouped.set(record.discoveredJobId, entries);
  }
  return grouped;
}

const privateFields = ["ownerId", "userId", "authId", "discoveredJobId", "_creationTime", "_id"] as const;
type PrivateField = typeof privateFields[number];
function publicFields<T extends object>(record: T): Omit<T, PrivateField> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !privateFields.includes(key as PrivateField))) as Omit<T, PrivateField>;
}
function withoutOwnership<T extends { _id: string }>(record: T): { id: T["_id"] } & Omit<T, PrivateField> {
  return { id: record._id, ...publicFields(record) };
}
function exportedRecord<T extends TableNames, F extends PropertyValidators>(table: T, fields: F) {
  return v.object({ id: v.id(table), ...publicFields(fields) });
}

const exportRecords = {
  jobs: exportedRecord("jobs", schema.tables.jobs.validator.fields),
  resumeBundles: exportedRecord("resumeBundles", schema.tables.resumeBundles.validator.fields),
  targetProfiles: exportedRecord("targetProfiles", schema.tables.targetProfiles.validator.fields),
  discoveryScanRuns: exportedRecord("discoveryScanRuns", schema.tables.discoveryScanRuns.validator.fields),
  discoveredJobs: exportedRecord("discoveredJobs", schema.tables.discoveredJobs.validator.fields),
  discoveryMatchDecisions: exportedRecord("discoveryMatchDecisions", schema.tables.discoveryMatchDecisions.validator.fields),
  discoveryReviewerOverrides: exportedRecord("discoveryReviewerOverrides", schema.tables.discoveryReviewerOverrides.validator.fields),
  discoveryStatusHistory: exportedRecord("discoveryStatusHistory", schema.tables.discoveryStatusHistory.validator.fields),
  users: exportedRecord("users", schema.tables.users.validator.fields),
  hostedResumeRequests: exportedRecord("hostedResumeRequests", schema.tables.hostedResumeRequests.validator.fields),
  aiPilotOwners: exportedRecord("aiPilotOwners", schema.tables.aiPilotOwners.validator.fields),
  aiOwnerMonths: exportedRecord("aiOwnerMonths", schema.tables.aiOwnerMonths.validator.fields),
  aiBudgetAttempts: exportedRecord("aiBudgetAttempts", schema.tables.aiBudgetAttempts.validator.fields),
  enrollmentAuditEvents: exportedRecord("enrollmentAuditEvents", schema.tables.enrollmentAuditEvents.validator.fields),
  accountPrivacyEvents: exportedRecord("accountPrivacyEvents", schema.tables.accountPrivacyEvents.validator.fields),
};

export const exportData = query({
  args: {},
  returns: v.object({
    exportedAt: v.string(), format: v.literal("jobbie-account-export-v5"),
    jobs: v.array(exportRecords.jobs),
    resumeBundles: v.array(exportRecords.resumeBundles),
    targetProfile: v.union(exportRecords.targetProfiles, v.null()),
    discoveryScanRuns: v.array(exportRecords.discoveryScanRuns),
    discovery: v.array(v.object({
      ...exportRecords.discoveredJobs.fields,
      matchDecisions: v.array(exportRecords.discoveryMatchDecisions),
      reviewerOverrides: v.array(exportRecords.discoveryReviewerOverrides),
      statusHistory: v.array(exportRecords.discoveryStatusHistory),
    })),
    discoveryHistory: v.object({
      matchDecisions: v.array(v.object({ ...exportRecords.discoveryMatchDecisions.fields, discoveredJobId: v.id("discoveredJobs") })),
      reviewerOverrides: v.array(v.object({ ...exportRecords.discoveryReviewerOverrides.fields, discoveredJobId: v.id("discoveredJobs") })),
      statusHistory: v.array(v.object({ ...exportRecords.discoveryStatusHistory.fields, discoveredJobId: v.id("discoveredJobs") })),
    }),
    accountProfile: exportRecords.users,
    hostedResumeRequests: v.array(exportRecords.hostedResumeRequests),
    aiUsage: v.object({
      pilot: v.union(v.null(), exportRecords.aiPilotOwners),
      months: v.array(exportRecords.aiOwnerMonths),
      attempts: v.array(exportRecords.aiBudgetAttempts),
    }),
    enrollmentAuditEvents: v.array(exportRecords.enrollmentAuditEvents),
    enrollment: v.array(v.object({
      id: v.id("alphaInvites"), createdAt: v.number(), claimedAt: v.union(v.number(), v.null()),
      expiresAt: v.number(), expiredAt: v.union(v.number(), v.null()),
    })),
    privacyEvents: v.array(exportRecords.accountPrivacyEvents),
    privacy: v.union(v.null(), v.object({ acknowledgedAt: v.string(), policyVersion: v.union(v.string(), v.null()) })),
  }),
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const data = ownedAccountData(ctx, userId);
    const [jobs, discoveredJobs, matchDecisions, reviewerOverrides, statusHistory, profiles, scanRuns, resumeBundles,
      hostedRequests, pilots, ownerMonths, attempts, privacyEvents, invites] = await Promise.all([
      completeCategory(data.jobs, "jobs"), completeCategory(data.discoveredJobs, "discoveredJobs"),
      completeCategory(data.matchDecisions, "matchDecisions"), completeCategory(data.reviewerOverrides, "reviewerOverrides"),
      completeCategory(data.statusHistory, "statusHistory"), completeCategory(data.targetProfiles, "targetProfiles"),
      completeCategory(data.scanRuns, "scanRuns"), completeCategory(data.resumeBundles, "resumeBundles"),
      completeCategory(data.hostedRequests, "hostedRequests"), completeCategory(data.pilotOwners, "pilotOwners"),
      completeCategory(data.ownerMonths, "ownerMonths"), completeCategory(data.budgetAttempts, "budgetAttempts"),
      completeCategory(data.privacyEvents, "privacyEvents"), completeCategory(data.invites, "invites"),
    ]);
    const targetProfile = profiles[0] ?? null;
    const enrollmentAuditEvents = invites[0] ? await completeCategory(ctx.db.query("enrollmentAuditEvents")
      .withIndex("by_invite", q => q.eq("inviteId", invites[0]._id)), "enrollmentAuditEvents") : [];
    const decisionsByJob = groupByDiscoveredJob(matchDecisions);
    const overridesByJob = groupByDiscoveredJob(reviewerOverrides);
    const statusesByJob = groupByDiscoveredJob(statusHistory);
    const user = (await ctx.db.get(userId))!;
    return {
      exportedAt: new Date().toISOString(),
      format: "jobbie-account-export-v5" as const,
      accountProfile: withoutOwnership(user),
      hostedResumeRequests: hostedRequests.map(withoutOwnership),
      aiUsage: { pilot: pilots[0] ? withoutOwnership(pilots[0]) : null,
        months: ownerMonths.map(withoutOwnership), attempts: attempts.map(withoutOwnership) },
      enrollmentAuditEvents: enrollmentAuditEvents.map(withoutOwnership),
      enrollment: invites.map(item => ({ id: item._id, createdAt: item.createdAt, claimedAt: item.claimedAt ?? null,
        expiresAt: item.expiresAt, expiredAt: item.expiredAt ?? null })),
      privacyEvents: privacyEvents.map(withoutOwnership),
      // Preserve even orphaned legacy history instead of dropping it in a join.
      discoveryHistory: { matchDecisions: matchDecisions.map(item => ({ ...withoutOwnership(item), discoveredJobId: item.discoveredJobId })),
        reviewerOverrides: reviewerOverrides.map(item => ({ ...withoutOwnership(item), discoveredJobId: item.discoveredJobId })), statusHistory: statusHistory.map(item => ({ ...withoutOwnership(item), discoveredJobId: item.discoveredJobId })) },
      jobs: jobs.map(withoutOwnership),
      resumeBundles: resumeBundles.map(withoutOwnership),
      targetProfile: targetProfile === null ? null : withoutOwnership(targetProfile),
      discoveryScanRuns: scanRuns.map(withoutOwnership),
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

export const recordExportRequest = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    await ctx.db.insert("accountPrivacyEvents", { action: "exportRequested", occurredAt: Date.now(), userId });
    return null;
  },
});

// Internal bounded continuations; neither accepts a browser-controlled owner.
export const cleanupDeleted = internalMutation({
  args: { ownerId: v.id("users") }, returns: v.null(),
  handler: async (ctx, { ownerId }) => { await cleanupDeletedAccount(ctx, ownerId); return null; },
});
export const cleanupRole = internalMutation({
  args: { ownerId: v.id("users"), jobId: v.id("jobs"), bundleId: v.optional(v.id("resumeBundles")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const role = await ctx.db.get(args.jobId);
    const bundle = args.bundleId ? await ctx.db.get(args.bundleId) : null;
    if (args.bundleId ? bundle !== null : role !== null) throw new Error("Career record still exists");
    await cleanupRoleRequests(ctx, args);
    return null;
  },
});
