import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireVerifiedUser } from "./auth";
import { requireEnrolledUser } from "./enrollment";
import { PRIVACY_POLICY_VERSION, requireCurrentPrivacyAcknowledgement } from "./privacy";
import { ownedJob } from "./resumeBundles";
import { parseResumeDraft, tailoringBrief } from "../src/resumeTailoring";

export const HOSTED_CONSENT_VERSION = "2026-10-24-zai-selected-evidence-v1";
// Transport bounds only; the future ledger must prove a billable token ceiling.
const MAX_BRIEF_BYTES = 100_000;
const failureCode = v.union(
  v.literal("staleEvidence"), v.literal("accessRevoked"),
  v.literal("invalidDraft"), v.literal("providerFailed"),
  v.literal("providerBalance"), v.literal("providerRateLimited"),
  v.literal("providerOverloaded"), v.literal("providerTimeout"), v.literal("unavailable"),
);
const requestStatus = v.object({
  requestId: v.id("hostedResumeRequests"), jobId: v.id("jobs"),
  bundleRevision: v.number(), provider: v.literal("zai"), model: v.literal("glm-4.7"),
  status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
  createdAt: v.number(), finishedAt: v.optional(v.number()),
  failureCode: v.optional(failureCode),
});

function validateEvidence(role: { company: string; title: string }, source: string, posting: string) {
  if (source.length > 40_000 || posting.length > 40_000) throw new Error("Evidence exceeds 40,000 characters");
  // Reuse the import validator for plain text and the canonical factual prompt.
  parseResumeDraft(source, "source resume");
  parseResumeDraft(posting);
  const brief = tailoringBrief(role, source, posting);
  if (new TextEncoder().encode(brief).byteLength > MAX_BRIEF_BYTES) throw new Error("Selected evidence is too large for hosted generation");
}

// Records intent only. No scheduling, provider call, retry, or budget exemption.
// Dispatch must be added only through the separately implemented admission ledger.
export const request = mutation({
  args: {
    jobId: v.id("jobs"), expectedRevision: v.number(),
    consent: v.object({ provider: v.literal("zai"), model: v.literal("glm-4.7"),
      version: v.string(), shareSelectedEvidence: v.boolean() }),
  },
  returns: v.id("hostedResumeRequests"),
  handler: async (ctx, { jobId, expectedRevision, consent }) => {
    const ownerId = await ownedJob(ctx, jobId);
    await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
    if (!consent.shareSelectedEvidence || consent.version !== HOSTED_CONSENT_VERSION) {
      throw new Error("Explicit consent to share selected evidence with Z.ai is required");
    }
    const saved = await ctx.db.query("resumeBundles")
      .withIndex("by_owner_job", q => q.eq("ownerId", ownerId).eq("jobId", jobId)).unique();
    if (!saved || !Number.isSafeInteger(expectedRevision) || saved.revision !== expectedRevision) {
      throw new Error("Save and reload the current bundle before requesting a draft");
    }
    const job = (await ctx.db.get(jobId))!;
    validateEvidence(job, saved.sourceResume, saved.description);
    const pending = await ctx.db.query("hostedResumeRequests")
      .withIndex("by_owner_status", q => q.eq("ownerId", ownerId).eq("status", "pending")).first();
    if (pending) throw new Error("A hosted request is already pending for this account");
    const now = Date.now();
    return await ctx.db.insert("hostedResumeRequests", {
      ownerId, jobId, bundleId: saved._id, bundleRevision: saved.revision,
      company: job.company, title: job.title, provider: consent.provider, model: consent.model,
      consentVersion: consent.version, consentedAt: now, privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      status: "pending", createdAt: now,
    });
  },
});

// Reactive metadata for one owned request; never return another owner's record.
export const status = query({
  args: { requestId: v.id("hostedResumeRequests") },
  returns: v.union(requestStatus, v.null()),
  handler: async (ctx, { requestId }) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const item = await ctx.db.get(requestId);
    if (!item || item.ownerId !== ownerId) return null;
    return { requestId, jobId: item.jobId, bundleRevision: item.bundleRevision,
      provider: item.provider, model: item.model, status: item.status,
      createdAt: item.createdAt, finishedAt: item.finishedAt, failureCode: item.failureCode };
  },
});

async function failRequest(ctx: MutationCtx, item: Doc<"hostedResumeRequests">,
  code: NonNullable<Doc<"hostedResumeRequests">["failureCode"]>) {
  await ctx.db.patch(item._id, { status: "failed", failureCode: code, finishedAt: Date.now() });
  return false;
}

// Trusted server callback only. The execution task must verify provider identity,
// finish reason and billed reservation before invoking this transition.
// A terminal callback is a no-op on redelivery and never creates a bundle/user.
export const complete = internalMutation({
  args: { requestId: v.id("hostedResumeRequests"), draft: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { requestId, draft }) => {
    const item = await ctx.db.get(requestId);
    if (!item || item.status !== "pending") return false;
    const owner = await ctx.db.get(item.ownerId);
    if (!owner || owner.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || owner.privacyAcknowledgedAt === undefined
      || item.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || item.consentVersion !== HOSTED_CONSENT_VERSION) {
      return await failRequest(ctx, item, "accessRevoked");
    }
    try { await requireEnrolledUser(ctx, item.ownerId); }
    catch { return await failRequest(ctx, item, "accessRevoked"); }
    const saved = await ctx.db.get(item.bundleId);
    const job = await ctx.db.get(item.jobId);
    if (!saved || !job || saved.ownerId !== item.ownerId || job.ownerId !== item.ownerId
      || saved.jobId !== item.jobId || saved.revision !== item.bundleRevision
      || job.company !== item.company || job.title !== item.title) {
      return await failRequest(ctx, item, "staleEvidence");
    }
    let resume: string;
    try { resume = parseResumeDraft(draft); }
    catch { return await failRequest(ctx, item, "invalidDraft"); }
    await ctx.db.patch(saved._id, { resume, revision: saved.revision + 1, reviewedAt: null, updatedAt: Date.now() });
    await ctx.db.patch(requestId, { status: "succeeded", finishedAt: Date.now() });
    return true;
  },
});

export const fail = internalMutation({
  args: { requestId: v.id("hostedResumeRequests"), code: failureCode },
  returns: v.boolean(),
  handler: async (ctx, { requestId, code }) => {
    const item = await ctx.db.get(requestId);
    if (!item || item.status !== "pending") return false;
    await failRequest(ctx, item, code);
    return true;
  },
});
