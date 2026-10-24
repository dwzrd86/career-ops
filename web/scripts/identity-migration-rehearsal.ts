// Preparation only: not a registered Convex endpoint or release-time runner.
// Execute inside one test transaction. Promotion requires an approved legacy
// expand schema, occupancy manifest, frozen writes and backup/restore evidence.
import type { MutationCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import { components } from "../convex/_generated/api";
import { ownedAccountData } from "../convex/accountLifecycle";

export async function rehearseIdentityRebind(ctx: MutationCtx, input: {
  ownerId: Id<"users">;
  expectedLegacyAuthId: string | null;
  verifiedAuthId: string;
}) {
  const owner = await ctx.db.get(input.ownerId);
  if (!owner || (owner.authId ?? null) !== input.expectedLegacyAuthId) throw new Error("Stale legacy mapping");
  if (!owner.email || !owner.emailVerificationTime) throw new Error("Legacy verified contact required");
  const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "_id", value: input.verifiedAuthId }],
  });
  if (!authUser?.emailVerified || authUser.email.trim().toLowerCase() !== owner.email.trim().toLowerCase()) {
    throw new Error("Verified recovery contact mismatch");
  }
  // Deliberately bounded pilot rehearsal. A real inventory may require a
  // paginated operator-reviewed manifest; never silently truncate it.
  const owners = await ctx.db.query("users").take(101);
  if (owners.length > 100) throw new Error("Owner inventory exceeds rehearsal bound");
  if (owners.filter(row => row.email?.trim().toLowerCase() === owner.email!.trim().toLowerCase()).length !== 1) {
    throw new Error("Ambiguous legacy contact");
  }
  const replacement = await ctx.db.query("users")
    .withIndex("by_auth_id", q => q.eq("authId", input.verifiedAuthId)).unique();
  if (!replacement || replacement._id === owner._id) throw new Error("Fresh recovery mapping required");
  if (replacement.privacyAcknowledgedAt !== undefined) throw new Error("Recovery account already used");
  const data = ownedAccountData(ctx, replacement._id);
  for (const [name, query] of Object.entries(data)) {
    if (name !== "invites" && (await query.take(1)).length) throw new Error("Recovery account already used");
  }
  const invites = await data.invites.take(2);
  if (invites.length !== 1 || invites[0].expiredAt !== undefined || invites[0].claimedAt === undefined) {
    throw new Error("Fresh recovery enrollment required");
  }
  // Keep every existing ownerId/jobId/bundleId. Never copy a credential,
  // mint a verified flag, or run the account-deletion cleanup trigger here.
  await ctx.db.patch(owner._id, { authId: input.verifiedAuthId });
  await ctx.db.patch(invites[0]._id, { claimedBy: owner._id });
  await ctx.db.delete(replacement._id);
  return owner._id;
}
