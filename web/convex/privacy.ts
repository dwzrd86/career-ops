import { mutationGeneric, queryGeneric } from "convex/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireVerifiedUser } from "./auth";

// This identifies the published notice bundle. Policy content remains in the
// source-controlled documents; accounts retain only the version and time.
export const PRIVACY_POLICY_VERSION = "2026-08-01";

export async function requireCurrentPrivacyAcknowledgement(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const user = await ctx.db.get(userId);
  if (user?.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || user.privacyAcknowledgedAt === undefined) {
    throw new Error("Privacy acknowledgement required before saving career data");
  }
}

export const status = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const user = await ctx.db.get(userId);
    const acknowledgedAt = user?.privacyPolicyVersion === PRIVACY_POLICY_VERSION
      ? user.privacyAcknowledgedAt ?? null
      : null;

    return {
      acknowledgedAt,
      currentVersion: PRIVACY_POLICY_VERSION,
      requiresAcknowledgement: acknowledgedAt === null,
    };
  },
});

export const acknowledge = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const user = await ctx.db.get(userId);

    // Keep the initial acknowledgement time for a version; a changed policy
    // version receives a new acknowledgement when this constant changes.
    if (user?.privacyPolicyVersion === PRIVACY_POLICY_VERSION && user.privacyAcknowledgedAt !== undefined) {
      return;
    }

    await ctx.db.patch(userId, {
      privacyAcknowledgedAt: Date.now(),
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    });
  },
});
