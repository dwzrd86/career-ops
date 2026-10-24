import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ADMISSION_CUTOFF, MONTHLY_ATTEMPTS, PILOT_CAP, priceFields } from "./aiBudgetModel";
import { requireEnrolledUser } from "./enrollment";
import { HOSTED_CONSENT_VERSION } from "./hostedResumes";
import { PRIVACY_POLICY_VERSION, requireCurrentPrivacyAcknowledgement } from "./privacy";

function integer(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
function monthNow() { return new Date(Date.now()).toISOString().slice(0, 7); }
async function control(ctx: QueryCtx | MutationCtx) {
  return await ctx.db.query("aiBudgetControl").withIndex("by_key", q => q.eq("key", "shared")).unique();
}
async function ownerSlot(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">) {
  return await ctx.db.query("aiPilotOwners").withIndex("by_owner", q => q.eq("ownerId", ownerId)).unique();
}
async function budgetMonth(ctx: QueryCtx | MutationCtx, month: string) {
  return await ctx.db.query("aiBudgetMonths").withIndex("by_month", q => q.eq("month", month)).unique();
}
function enabled(state: Doc<"aiBudgetControl"> | null) {
  if (!state?.enabled || process.env.HOSTED_AI_EXECUTION_ENABLED !== "true") throw new Error("Hosted AI admission disabled");
  return state;
}

// Internal operator controls only; no browser-supplied limits or exemptions.
// A missing control row or runtime switch is fail-closed. Cutoff may never exceed the approved $8 ceiling.
export const configure = internalMutation({
  args: { enabled: v.boolean(), cutoffMicroUsd: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    integer(args.cutoffMicroUsd, "cutoff", 1, ADMISSION_CUTOFF);
    const state = await control(ctx);
    if (state) await ctx.db.patch(state._id, args);
    else await ctx.db.insert("aiBudgetControl", { key: "shared", ...args, unresolvedMicroUsd: 0, pilotCount: 0 });
    return null;
  },
});

export const approvePrice = internalMutation({
  args: priceFields, returns: v.null(),
  handler: async (ctx, args) => {
    // Conditional alternative is a separately consented request choice, never fallback.
    if (!((args.provider === "zai" && args.model === "glm-4.7")
      || (args.provider === "anthropic" && args.model === "claude-sonnet-4-6"))) throw new Error("Unapproved provider/model");
    integer(args.inputMicroUsdPerMillion, "input price", 1, 1_000_000_000);
    integer(args.outputMicroUsdPerMillion, "output price", 1, 1_000_000_000);
    integer(args.maxInputTokens, "input ceiling", 1, 1_000_000);
    integer(args.maxTotalOutputTokens, "total output ceiling", 1, 1_000_000);
    integer(args.validUntil, "price expiration", Date.now() + 1);
    if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(args.evidence)) throw new Error("Bound/pricing evidence reference required");
    const existing = await ctx.db.query("aiBudgetPrices")
      .withIndex("by_provider_model", q => q.eq("provider", args.provider).eq("model", args.model)).unique();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("aiBudgetPrices", args);
    return null;
  },
});

export const setPilotOwner = internalMutation({
  args: { ownerId: v.id("users"), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, { ownerId, active }) => {
    const state = await control(ctx);
    if (!state) throw new Error("Budget is not configured");
    const slot = await ownerSlot(ctx, ownerId);
    if (slot?.active === active) return null;
    if (active) {
      if (!await ctx.db.get(ownerId)) throw new Error("Account unavailable");
      await requireEnrolledUser(ctx, ownerId);
      if (state.pilotCount >= PILOT_CAP) throw new Error("Five-person AI pilot capacity reached");
    } else if (slot?.activeAttemptId) throw new Error("Unresolved attempt prevents pilot release");
    if (slot) await ctx.db.patch(slot._id, { active, updatedAt: Date.now() });
    else if (active) await ctx.db.insert("aiPilotOwners", { ownerId, active, updatedAt: Date.now() });
    else return null;
    await ctx.db.patch(state._id, { pilotCount: state.pilotCount + (active ? 1 : -1) });
    return null;
  },
});

async function currentEvidence(ctx: MutationCtx, item: Doc<"hostedResumeRequests">) {
  await requireEnrolledUser(ctx, item.ownerId);
  await requireCurrentPrivacyAcknowledgement(ctx, item.ownerId);
  const bundle = await ctx.db.get(item.bundleId);
  const job = await ctx.db.get(item.jobId);
  if (item.status !== "pending" || item.consentVersion !== HOSTED_CONSENT_VERSION
    || item.privacyPolicyVersion !== PRIVACY_POLICY_VERSION
    || !bundle || !job || bundle.ownerId !== item.ownerId || job.ownerId !== item.ownerId
    || bundle.jobId !== item.jobId || bundle.revision !== item.bundleRevision
    || job.company !== item.company || job.title !== item.title) throw new Error("Request evidence/access changed");
}

// One reservation per request; explicit retries/regenerations require a NEW
// request and consume quota again. No SDK, scheduler or inference runs here.
export const reserve = internalMutation({
  args: { requestId: v.id("hostedResumeRequests") }, returns: v.id("aiBudgetAttempts"),
  handler: async (ctx, { requestId }) => {
    const previous = await ctx.db.query("aiBudgetAttempts").withIndex("by_request", q => q.eq("requestId", requestId)).unique();
    if (previous) return previous._id;
    const state = enabled(await control(ctx));
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("Request unavailable");
    await currentEvidence(ctx, request);
    const slot = await ownerSlot(ctx, request.ownerId);
    if (!slot?.active) throw new Error("AI pilot admission required");
    if (slot.activeAttemptId) throw new Error("One active attempt per owner");
    const price = await ctx.db.query("aiBudgetPrices")
      .withIndex("by_provider_model", q => q.eq("provider", request.provider).eq("model", request.model)).unique();
    if (!price || price.validUntil <= Date.now()) throw new Error("Verified price/token ceiling unavailable");
    // BigInt arithmetic + ceiling division avoids a fractional-unit under-reserve.
    const cost = Number((BigInt(price.maxInputTokens) * BigInt(price.inputMicroUsdPerMillion)
      + BigInt(price.maxTotalOutputTokens) * BigInt(price.outputMicroUsdPerMillion) + 999_999n) / 1_000_000n);
    integer(cost, "reservation", 1);
    const month = monthNow();
    const totals = await budgetMonth(ctx, month);
    const owner = await ctx.db.query("aiOwnerMonths")
      .withIndex("by_owner_month", q => q.eq("ownerId", request.ownerId).eq("month", month)).unique();
    if ((owner?.attempts ?? 0) >= MONTHLY_ATTEMPTS) throw new Error("Monthly attempt quota exhausted");
    // Carry ALL unresolved months into new admissions. Settlement still bills
    // the original month; changing month/restarting never releases liability.
    if ((totals?.settledMicroUsd ?? 0) + state.unresolvedMicroUsd + cost > state.cutoffMicroUsd) throw new Error("Shared AI budget exhausted");
    const { _id: _priceId, _creationTime: _priceTime, ...snapshot } = price;
    const id = await ctx.db.insert("aiBudgetAttempts", { ...snapshot, ownerId: request.ownerId,
      requestId, month, reservedMicroUsd: cost, state: "reserved", createdAt: Date.now() });
    await ctx.db.patch(state._id, { unresolvedMicroUsd: state.unresolvedMicroUsd + cost });
    await ctx.db.patch(slot._id, { activeAttemptId: id });
    if (totals) await ctx.db.patch(totals._id, { reservedMicroUsd: totals.reservedMicroUsd + cost });
    else await ctx.db.insert("aiBudgetMonths", { month, settledMicroUsd: 0, reservedMicroUsd: cost });
    if (owner) await ctx.db.patch(owner._id, { attempts: owner.attempts + 1 });
    else await ctx.db.insert("aiOwnerMonths", { ownerId: request.ownerId, month, attempts: 1 });
    return id;
  },
});

const dispatchPermit = v.object({ requestId: v.id("hostedResumeRequests"), provider: v.string(),
  model: v.string(), maxInputTokens: v.number(), maxTotalOutputTokens: v.number() });
// Future server adapter MUST claim immediately before its single bounded call.
// Redelivery/restart returns null forever once claimed: never replay inference
// on an ambiguous dispatch. No lease expiry or browser refund exists.
export const claimDispatch = internalMutation({
  args: { attemptId: v.id("aiBudgetAttempts") }, returns: v.union(dispatchPermit, v.null()),
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt || attempt.state !== "reserved") return null;
    const state = enabled(await control(ctx));
    if (state.activeAttemptId) throw new Error("One global provider call at a time");
    const price = await ctx.db.query("aiBudgetPrices")
      .withIndex("by_provider_model", q => q.eq("provider", attempt.provider).eq("model", attempt.model)).unique();
    if (attempt.validUntil <= Date.now()) throw new Error("Reservation price expired");
    if (!price || price.evidence !== attempt.evidence || price.validUntil !== attempt.validUntil
      || price.inputMicroUsdPerMillion !== attempt.inputMicroUsdPerMillion
      || price.outputMicroUsdPerMillion !== attempt.outputMicroUsdPerMillion
      || price.maxInputTokens !== attempt.maxInputTokens
      || price.maxTotalOutputTokens !== attempt.maxTotalOutputTokens) throw new Error("Reservation pricing/bounds changed");
    const request = await ctx.db.get(attempt.requestId);
    if (!request) throw new Error("Request unavailable");
    await currentEvidence(ctx, request);
    const slot = await ownerSlot(ctx, attempt.ownerId);
    if (!slot?.active || slot.activeAttemptId !== attemptId) throw new Error("AI pilot admission required");
    const totals = await budgetMonth(ctx, monthNow());
    if ((totals?.settledMicroUsd ?? 0) + state.unresolvedMicroUsd > state.cutoffMicroUsd) throw new Error("Shared AI budget exhausted");
    await ctx.db.patch(attemptId, { state: "dispatched", dispatchedAt: Date.now() });
    await ctx.db.patch(state._id, { activeAttemptId: attemptId });
    return { requestId: attempt.requestId, provider: attempt.provider, model: attempt.model,
      maxInputTokens: attempt.maxInputTokens, maxTotalOutputTokens: attempt.maxTotalOutputTokens };
  },
});

// Trusted billing reconciliation only. null means unknown, even for timeout,
// failure or disconnect. A reserved-but-never-dispatched call can settle at 0;
// claimed calls require provider usage evidence, including explicit zero usage.
export const settle = internalMutation({
  args: { attemptId: v.id("aiBudgetAttempts"), billedMicroUsd: v.union(v.number(), v.null()) },
  returns: v.boolean(),
  handler: async (ctx, { attemptId, billedMicroUsd }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) throw new Error("Attempt unavailable");
    if (attempt.state === "settled") {
      if (billedMicroUsd !== null && billedMicroUsd !== attempt.billedMicroUsd) throw new Error("Conflicting settlement");
      return false;
    }
    const state = (await control(ctx))!;
    if (billedMicroUsd === null) {
      if (attempt.state !== "reserved") {
        await ctx.db.patch(attemptId, { state: "unknown" });
        // Keep the global in-flight lock too: a timed-out call may still be running.
      }
      return false;
    }
    integer(billedMicroUsd, "billed usage", 0, 1_000_000_000);
    if (attempt.state === "reserved" && billedMicroUsd !== 0) throw new Error("Attempt was not dispatched");
    const totals = (await budgetMonth(ctx, attempt.month))!;
    const settled = integer(totals.settledMicroUsd + billedMicroUsd, "settled total");
    await ctx.db.patch(totals._id, { settledMicroUsd: settled, reservedMicroUsd: totals.reservedMicroUsd - attempt.reservedMicroUsd });
    await ctx.db.patch(state._id, { unresolvedMicroUsd: state.unresolvedMicroUsd - attempt.reservedMicroUsd,
      ...(state.activeAttemptId === attemptId ? { activeAttemptId: undefined } : {}),
      // Record an unexpected bill rather than losing it to transaction rollback.
      ...(billedMicroUsd > attempt.reservedMicroUsd ? { enabled: false } : {}) });
    const slot = await ownerSlot(ctx, attempt.ownerId);
    if (slot?.activeAttemptId === attemptId) await ctx.db.patch(slot._id, { activeAttemptId: undefined });
    await ctx.db.patch(attemptId, { state: "settled", billedMicroUsd, settledAt: Date.now() });
    return true;
  },
});

export const summary = internalQuery({
  args: {}, returns: v.object({ enabled: v.boolean(), cutoffMicroUsd: v.number(),
    settledMicroUsd: v.number(), unresolvedMicroUsd: v.number(), warning: v.union(v.literal(0), v.literal(5), v.literal(7)), pilotCount: v.number() }),
  handler: async ctx => {
    const state = await control(ctx);
    const totals = await budgetMonth(ctx, monthNow());
    const settled = totals?.settledMicroUsd ?? 0;
    const exposure = settled + (state?.unresolvedMicroUsd ?? 0);
    const warning: 0 | 5 | 7 = exposure >= 7_000_000 ? 7 : exposure >= 5_000_000 ? 5 : 0;
    return { enabled: !!state?.enabled && process.env.HOSTED_AI_EXECUTION_ENABLED === "true",
      cutoffMicroUsd: state?.cutoffMicroUsd ?? ADMISSION_CUTOFF, settledMicroUsd: settled,
      unresolvedMicroUsd: state?.unresolvedMicroUsd ?? 0,
      warning, pilotCount: state?.pilotCount ?? 0 };
  },
});
