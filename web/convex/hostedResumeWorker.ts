"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { callProvider, providerBody } from "./hostedProvider";

// Internal execution entry point. UI/scheduling wiring is a separate task.
// Duplicate deliveries consume the same reservation and can never replay a call.
export const execute = internalAction({
  args: { requestId: v.id("hostedResumeRequests") }, returns: v.null(),
  handler: async (ctx, { requestId }) => {
    let attemptId: Id<"aiBudgetAttempts">;
    try { attemptId = await ctx.runMutation(internal.aiBudget.reserve, { requestId }); }
    catch {
      await ctx.runMutation(internal.hostedResumes.fail, { requestId, code: "unavailable" });
      return null;
    }
    // Claim transaction rechecks access, current evidence, pricing and both kill
    // switches and returns exactly that evidence snapshot; no query/claim race.
    let permit;
    try { permit = await ctx.runMutation(internal.aiBudget.claimDispatch, { attemptId }); }
    catch {
      // Refund only if nobody claimed the reservation in the meantime.
      await ctx.runMutation(internal.aiBudget.cancelUnclaimed, { attemptId });
      return null;
    }
    if (!permit) return null;
    let body: string, key: string;
    try {
      key = process.env.HOSTED_AI_ZAI_API_KEY ?? "";
      if (!key || /\s/.test(key)) throw new Error("UNAVAILABLE");
      body = providerBody(permit, process.env.HOSTED_AI_ZAI_BOUND_EVIDENCE);
    } catch {
      // This sole permit holder knows fetch was never invoked. Quota is kept.
      await ctx.runMutation(internal.aiBudget.settle, { attemptId, billedMicroUsd: 0 });
      await ctx.runMutation(internal.hostedResumes.fail, { requestId, code: "unavailable" });
      return null;
    }
    const result = await callProvider(body, key, permit);
    // Unknown usage retains locks/reservation even if a valid-looking text exists.
    await ctx.runMutation(internal.aiBudget.settle, { attemptId, billedMicroUsd: result.billedMicroUsd });
    if (result.draft !== null && result.billedMicroUsd !== null) {
      await ctx.runMutation(internal.hostedResumes.complete, { requestId, draft: result.draft });
    } else {
      await ctx.runMutation(internal.hostedResumes.fail, { requestId,
        code: result.failureCode ?? (result.billedMicroUsd === null ? "providerFailed" : "invalidDraft") });
    }
    return null;
  },
});
