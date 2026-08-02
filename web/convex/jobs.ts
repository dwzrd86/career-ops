import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireVerifiedUser } from "./auth";
import { requireCurrentPrivacyAcknowledgement } from "./privacy";

const MAX_JOBS_PER_LIST = 100;
const jobFieldLimits = {
  company: 160,
  location: 160,
  notes: 4_000,
  source: 160,
  title: 200,
  url: 2_048,
} as const;

const jobStatus = v.union(
  v.literal("discovered"),
  v.literal("evaluated"),
  v.literal("applied"),
  v.literal("interview"),
  v.literal("offer"),
  v.literal("rejected"),
  v.literal("discarded"),
);

function normalizeText(value: string, field: keyof typeof jobFieldLimits, required = true) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && normalized.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (normalized.length > jobFieldLimits[field]) {
    throw new Error(`${field} must be at most ${jobFieldLimits[field]} characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, field: "notes") {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value, field, false);
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeHttpsUrl(value: string) {
  const normalized = normalizeText(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("url must be a valid HTTPS URL");
  }

  if (parsed.protocol !== "https:" || parsed.hostname.length === 0 || parsed.username || parsed.password) {
    throw new Error("url must be a valid HTTPS URL");
  }
  return parsed.toString();
}

export const list = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    return await ctx.db
      .query("jobs")
      .withIndex("by_owner_created_at", (query) => query.eq("ownerId", userId))
      .order("desc")
      .take(MAX_JOBS_PER_LIST);
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
    await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
    const now = Date.now();
    return await ctx.db.insert("jobs", {
      company: normalizeText(args.company, "company"),
      location: normalizeText(args.location, "location"),
      notes: normalizeOptionalText(args.notes, "notes"),
      ownerId,
      status: "discovered",
      source: normalizeText(args.source, "source"),
      title: normalizeText(args.title, "title"),
      url: normalizeHttpsUrl(args.url),
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
    await requireCurrentPrivacyAcknowledgement(ctx, userId);
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId) {
      throw new Error("Job not found");
    }
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
  },
});

export const remove = mutationGeneric({
  args: { id: v.id("jobs") },
  handler: async (ctx, { id }) => {
    const userId = await requireVerifiedUser(ctx);
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId) {
      throw new Error("Job not found");
    }
    await ctx.db.delete(id);
  },
});
