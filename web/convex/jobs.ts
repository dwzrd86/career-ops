import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireVerifiedUser } from "./auth";

const jobStatus = v.union(
  v.literal("discovered"),
  v.literal("evaluated"),
  v.literal("applied"),
  v.literal("interview"),
  v.literal("offer"),
  v.literal("rejected"),
  v.literal("discarded"),
);

export const list = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    return await ctx.db
      .query("jobs")
      .withIndex("by_owner_created_at", (query) => query.eq("ownerId", userId))
      .order("desc")
      .take(100);
  },
});

export const create = mutationGeneric({
  args: {
    company: v.string(),
    title: v.string(),
    location: v.string(),
    url: v.string(),
    source: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireVerifiedUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("jobs", {
      ...args,
      ownerId,
      status: "discovered",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutationGeneric({
  args: {
    id: v.id("jobs"),
    status: jobStatus,
  },
  handler: async (ctx, { id, status }) => {
    const userId = await requireVerifiedUser(ctx);
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId) {
      throw new Error("Job not found");
    }
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
  },
});
