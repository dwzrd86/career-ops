import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireVerifiedUser } from "./auth";
import { requireEnrolledUser } from "./enrollment";
import { requireCurrentPrivacyAcknowledgement } from "./privacy";

// Caps also bound account exports and transactional account deletion.
export const MAX_RESUME_BUNDLES = 50;
const content = {
  sourceResume: v.string(),
  description: v.string(),
  resume: v.string(),
};
const bundle = v.object({
  jobId: v.id("jobs"),
  ...content,
  revision: v.number(),
  reviewedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});

async function ownedJob(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">) {
  const ownerId = await requireVerifiedUser(ctx);
  await requireEnrolledUser(ctx, ownerId);
  const job = await ctx.db.get(jobId);
  if (!job || job.ownerId !== ownerId) throw new Error("Job not found");
  return ownerId;
}

export const get = query({
  args: { jobId: v.id("jobs") },
  returns: v.union(bundle, v.null()),
  handler: async (ctx, { jobId }) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== ownerId) return null;
    const saved = await ctx.db.query("resumeBundles")
      .withIndex("by_owner_job", (q) => q.eq("ownerId", ownerId).eq("jobId", jobId)).unique();
    if (!saved) return null;
    return { jobId, sourceResume: saved.sourceResume, description: saved.description,
      resume: saved.resume, revision: saved.revision, reviewedAt: saved.reviewedAt, updatedAt: saved.updatedAt };
  },
});

// Reuse canonical evidence, never a role-specific generated draft. The existing
// bundle cap bounds both reads and the amount of source text returned.
export const sources = query({
  args: {},
  returns: v.array(v.object({ jobId: v.id("jobs"), company: v.string(), title: v.string(), sourceResume: v.string(), updatedAt: v.number() })),
  handler: async (ctx) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const saved = await ctx.db.query("resumeBundles")
      .withIndex("by_owner_job", q => q.eq("ownerId", ownerId)).take(MAX_RESUME_BUNDLES);
    const seen = new Set<string>();
    const result = [];
    for (const item of saved.sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (seen.has(item.sourceResume)) continue;
      const job = await ctx.db.get(item.jobId);
      if (!job || job.ownerId !== ownerId) continue;
      seen.add(item.sourceResume);
      result.push({ jobId: item.jobId, company: job.company, title: job.title, sourceResume: item.sourceResume, updatedAt: item.updatedAt });
    }
    return result;
  },
});

export const save = mutation({
  args: { jobId: v.id("jobs"), ...content, reviewed: v.boolean(), expectedRevision: v.union(v.number(), v.null()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const ownerId = await ownedJob(ctx, args.jobId);
    await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
    for (const field of ["sourceResume", "description", "resume"] as const) {
      if (!args[field].trim() || args[field].length > 40000) {
        throw new Error(`${field} must contain 1–40,000 characters`);
      }
    }
    const saved = await ctx.db.query("resumeBundles")
      .withIndex("by_owner_job", (q) => q.eq("ownerId", ownerId).eq("jobId", args.jobId)).unique();
    if ((saved?.revision ?? null) !== args.expectedRevision) {
      throw new Error("This bundle changed in another tab. Reload the saved bundle before saving again.");
    }
    if (!saved) {
      const existing = await ctx.db.query("resumeBundles")
        .withIndex("by_owner_job", (q) => q.eq("ownerId", ownerId)).take(MAX_RESUME_BUNDLES);
      if (existing.length >= MAX_RESUME_BUNDLES) throw new Error("You can save up to 50 resume bundles. Delete an old bundle first.");
    }
    const now = Date.now();
    const revision = (saved?.revision ?? 0) + 1;
    const fields = { sourceResume: args.sourceResume, description: args.description, resume: args.resume,
      revision, reviewedAt: args.reviewed ? now : null, updatedAt: now };
    if (saved) await ctx.db.patch(saved._id, fields);
    else await ctx.db.insert("resumeBundles", { ...fields, ownerId, jobId: args.jobId });
    return revision;
  },
});

export const remove = mutation({
  args: { jobId: v.id("jobs"), expectedRevision: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, expectedRevision }) => {
    const ownerId = await ownedJob(ctx, jobId);
    const saved = await ctx.db.query("resumeBundles")
      .withIndex("by_owner_job", (q) => q.eq("ownerId", ownerId).eq("jobId", jobId)).unique();
    if (saved) {
      if (saved.revision !== expectedRevision) throw new Error("This bundle changed in another tab. Reload before deleting.");
      await ctx.db.delete(saved._id);
    }
    return null;
  },
});
