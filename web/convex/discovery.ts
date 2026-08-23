import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireVerifiedUser } from "./auth";
import { requireEnrolledUser } from "./enrollment";
import { reportBackendError } from "./errorReporting";
import { requireCurrentPrivacyAcknowledgement } from "./privacy";

const MAX_DISCOVERED_JOBS_PER_LIST = 100;
const MAX_HARD_FILTERS = 24;
const MAX_EXPLANATION_CODES = 24;
const LOCAL_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const fieldLimits = {
  company: 160,
  localJobId: 128,
  location: 160,
  overrideReason: 500,
  reasonCode: 80,
  ruleId: 120,
  sourceLabel: 160,
  title: 200,
  url: 2_048,
} as const;

const sourceProvider = v.union(
  v.literal("greenhouse"),
  v.literal("ashby"),
  v.literal("lever"),
  v.literal("interceptor"),
  v.literal("manual"),
);
const freshnessStatus = v.union(
  v.literal("fresh"),
  v.literal("stale"),
  v.literal("unknown"),
  v.literal("expired"),
);
const reviewStatus = v.union(
  v.literal("discovered"),
  v.literal("shortlisted"),
  v.literal("archived"),
  v.literal("approvedForEvaluation"),
);
const decisionOutcome = v.union(
  v.literal("rejected"),
  v.literal("ranked"),
  v.literal("needsReview"),
);
const hardFilterOutcome = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("unknown"),
  v.literal("notApplicable"),
);

type TextField = keyof typeof fieldLimits;

function normalizeText(value: string, field: TextField, required = true) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && normalized.length === 0) throw new Error(`${field} is required`);
  if (normalized.length > fieldLimits[field]) {
    throw new Error(`${field} must be at most ${fieldLimits[field]} characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, field: "location") {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value, field, false);
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeLocalJobId(value: string) {
  const normalized = normalizeText(value, "localJobId");
  if (!LOCAL_JOB_ID_PATTERN.test(normalized)) {
    throw new Error("localJobId must be a safe local record identifier");
  }
  return normalized;
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

function normalizeReasonCode(value: string, field: "reasonCode" | "ruleId") {
  const normalized = normalizeText(value, field);
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error(`${field} must be a stable uppercase code`);
  }
  return normalized;
}

function validateTimestamp(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a valid timestamp`);
  return value;
}

function validateScore(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("score must be between 0 and 100");
  return value;
}

async function requireOwnedDiscoveredJob(ctx: any, id: any, ownerId: any) {
  const job = await ctx.db.get(id);
  if (job === null || job.ownerId !== ownerId) throw new Error("Discovered job not found");
  return job;
}

async function requireReadyOwner(ctx: any) {
  const ownerId = await requireVerifiedUser(ctx);
  await requireEnrolledUser(ctx, ownerId);
  await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
  return ownerId;
}

async function setReviewStatus(ctx: any, ownerId: any, id: any, status: "shortlisted" | "archived" | "approvedForEvaluation") {
  const job = await requireOwnedDiscoveredJob(ctx, id, ownerId);
  const now = Date.now();
  await ctx.db.patch(id, { reviewStatus: status, updatedAt: now });
  await ctx.db.insert("discoveryStatusHistory", {
    discoveredJobId: id,
    occurredAt: now,
    ownerId,
    previousStatus: job.reviewStatus,
    status,
  });
}

export const list = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const jobs = await ctx.db
      .query("discoveredJobs")
      .withIndex("by_owner_discovered_at", (query: any) => query.eq("ownerId", ownerId))
      .order("desc")
      .take(MAX_DISCOVERED_JOBS_PER_LIST);

    return await Promise.all(jobs.map(async (job: any) => {
      const [decision, override] = await Promise.all([
        ctx.db
          .query("discoveryMatchDecisions")
          .withIndex("by_owner_job_decided_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", job._id))
          .order("desc")
          .first(),
        ctx.db
          .query("discoveryReviewerOverrides")
          .withIndex("by_owner_job_overridden_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", job._id))
          .order("desc")
          .first(),
      ]);
      const { ownerId: _ownerId, ...projectedJob } = job;
      const projectedDecision = decision === null ? null : (() => {
        const { ownerId: _decisionOwnerId, discoveredJobId: _discoveredJobId, ...value } = decision;
        return value;
      })();
      const projectedOverride = override === null ? null : (() => {
        const { ownerId: _overrideOwnerId, discoveredJobId: _discoveredJobId, ...value } = override;
        return value;
      })();
      return {
        ...projectedJob,
        decision: projectedDecision,
        effectiveOutcome: projectedOverride?.outcome ?? projectedDecision?.outcome ?? null,
        override: projectedOverride,
      };
    }));
  },
});

export const history = queryGeneric({
  args: { id: v.id("discoveredJobs") },
  handler: async (ctx, { id }) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    await requireOwnedDiscoveredJob(ctx, id, ownerId);
    const [statuses, decisions, overrides] = await Promise.all([
      ctx.db.query("discoveryStatusHistory")
        .withIndex("by_owner_job_occurred_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", id))
        .order("desc")
        .collect(),
      ctx.db.query("discoveryMatchDecisions")
        .withIndex("by_owner_job_decided_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", id))
        .order("desc")
        .collect(),
      ctx.db.query("discoveryReviewerOverrides")
        .withIndex("by_owner_job_overridden_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", id))
        .order("desc")
        .collect(),
    ]);
    return {
      decisions: decisions.map(({ ownerId: _ownerId, discoveredJobId: _discoveredJobId, ...decision }) => decision),
      overrides: overrides.map(({ ownerId: _ownerId, discoveredJobId: _discoveredJobId, ...override }) => override),
      statuses: statuses.map(({ ownerId: _ownerId, discoveredJobId: _discoveredJobId, ...status }) => status),
    };
  },
});

export const project = mutationGeneric({
  args: {
    localJobId: v.string(),
    company: v.string(),
    title: v.string(),
    location: v.optional(v.string()),
    url: v.string(),
    source: v.object({ label: v.string(), provider: sourceProvider }),
    freshness: v.object({ checkedAt: v.number(), postedAt: v.optional(v.number()), status: freshnessStatus }),
    discoveredAt: v.number(),
    decision: v.object({
      profileVersion: v.number(),
      outcome: decisionOutcome,
      score: v.optional(v.number()),
      hardFilters: v.array(v.object({ outcome: hardFilterOutcome, reasonCode: v.string(), ruleId: v.string() })),
      explanationCodes: v.array(v.string()),
      decidedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const ownerId = await requireReadyOwner(ctx);
      if (!Number.isInteger(args.decision.profileVersion) || args.decision.profileVersion < 1) {
        throw new Error("profileVersion must be a positive integer");
      }
      if (args.decision.hardFilters.length > MAX_HARD_FILTERS) throw new Error(`hardFilters must contain at most ${MAX_HARD_FILTERS} entries`);
      if (args.decision.explanationCodes.length > MAX_EXPLANATION_CODES) throw new Error(`explanationCodes must contain at most ${MAX_EXPLANATION_CODES} entries`);
      const localJobId = normalizeLocalJobId(args.localJobId);
      const now = Date.now();
      const existing = await ctx.db.query("discoveredJobs")
        .withIndex("by_owner_local_job", (query: any) => query.eq("ownerId", ownerId).eq("localJobId", localJobId))
        .unique();
      const projection = {
        company: normalizeText(args.company, "company"),
        discoveredAt: validateTimestamp(args.discoveredAt, "discoveredAt"),
        freshness: {
          checkedAt: validateTimestamp(args.freshness.checkedAt, "freshness.checkedAt"),
          postedAt: args.freshness.postedAt === undefined ? undefined : validateTimestamp(args.freshness.postedAt, "freshness.postedAt"),
          status: args.freshness.status,
        },
        localJobId,
        location: normalizeOptionalText(args.location, "location"),
        source: {
          label: normalizeText(args.source.label, "sourceLabel"),
          provider: args.source.provider,
        },
        title: normalizeText(args.title, "title"),
        updatedAt: now,
        url: normalizeHttpsUrl(args.url),
      };
      const discoveredJobId = existing === null
        ? await ctx.db.insert("discoveredJobs", { ...projection, ownerId, reviewStatus: "discovered" })
        : (await ctx.db.patch(existing._id, projection), existing._id);
      if (existing === null) {
        await ctx.db.insert("discoveryStatusHistory", {
          discoveredJobId,
          occurredAt: now,
          ownerId,
          status: "discovered",
        });
      }
      const decisionId = await ctx.db.insert("discoveryMatchDecisions", {
        decidedAt: validateTimestamp(args.decision.decidedAt, "decision.decidedAt"),
        discoveredJobId,
        explanationCodes: args.decision.explanationCodes.map((code) => normalizeReasonCode(code, "reasonCode")),
        hardFilters: args.decision.hardFilters.map((filter) => ({
          outcome: filter.outcome,
          reasonCode: normalizeReasonCode(filter.reasonCode, "reasonCode"),
          ruleId: normalizeReasonCode(filter.ruleId, "ruleId"),
        })),
        outcome: args.decision.outcome,
        ownerId,
        profileVersion: args.decision.profileVersion,
        score: validateScore(args.decision.score),
      });
      return { decisionId, discoveredJobId };
    } catch (error) {
      reportBackendError("discovery.project", "validationFailed");
      throw error;
    }
  },
});

export const shortlist = mutationGeneric({
  args: { id: v.id("discoveredJobs") },
  handler: async (ctx, { id }) => {
    try {
      await setReviewStatus(ctx, await requireReadyOwner(ctx), id, "shortlisted");
    } catch (error) {
      reportBackendError("discovery.shortlist");
      throw error;
    }
  },
});

export const archive = mutationGeneric({
  args: { id: v.id("discoveredJobs") },
  handler: async (ctx, { id }) => {
    try {
      await setReviewStatus(ctx, await requireReadyOwner(ctx), id, "archived");
    } catch (error) {
      reportBackendError("discovery.archive");
      throw error;
    }
  },
});

export const approveForEvaluation = mutationGeneric({
  args: { id: v.id("discoveredJobs") },
  handler: async (ctx, { id }) => {
    try {
      await setReviewStatus(ctx, await requireReadyOwner(ctx), id, "approvedForEvaluation");
    } catch (error) {
      reportBackendError("discovery.approve-for-evaluation");
      throw error;
    }
  },
});

export const overrideDecision = mutationGeneric({
  args: {
    id: v.id("discoveredJobs"),
    outcome: decisionOutcome,
    reason: v.string(),
  },
  handler: async (ctx, { id, outcome, reason }) => {
    try {
      const ownerId = await requireReadyOwner(ctx);
      await requireOwnedDiscoveredJob(ctx, id, ownerId);
      const baseDecision = await ctx.db.query("discoveryMatchDecisions")
        .withIndex("by_owner_job_decided_at", (query: any) => query.eq("ownerId", ownerId).eq("discoveredJobId", id))
        .order("desc")
        .first();
      await ctx.db.insert("discoveryReviewerOverrides", {
        baseDecisionId: baseDecision?._id,
        discoveredJobId: id,
        outcome,
        overriddenAt: Date.now(),
        ownerId,
        reason: normalizeText(reason, "overrideReason"),
      });
    } catch (error) {
      reportBackendError("discovery.override-decision");
      throw error;
    }
  },
});
