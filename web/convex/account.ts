import { mutationGeneric, queryGeneric } from "convex/server";
import { requireVerifiedUser } from "./auth";

export const exportData = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_owner_created_at", (query) => query.eq("ownerId", userId))
      .order("desc")
      .collect();
    const user = await ctx.db.get(userId);
    return {
      exportedAt: new Date().toISOString(),
      format: "jobbie-account-export-v1",
      jobs: jobs.map(({ _id, _creationTime, ownerId: _ownerId, ...job }) => ({ id: _id, createdAt: new Date(_creationTime).toISOString(), ...job })),
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
