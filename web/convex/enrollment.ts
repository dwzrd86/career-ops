import { actionGeneric, internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireVerifiedUser } from "./auth";
import { generateInviteToken, inviteTokenHash, secureEquals } from "./enrollmentCore";

const reservationDurationMs = 10 * 60 * 1000;
const maxInviteLifetimeMinutes = 60 * 24 * 30;

function recordEvent(
  ctx: MutationCtx,
  event: "inviteIssued" | "inviteReserved" | "inviteAccepted" | "inviteExpired" | "inviteRejected",
  inviteId?: Id<"alphaInvites">,
) {
  return ctx.db.insert("enrollmentAuditEvents", { event, inviteId, occurredAt: Date.now() });
}

async function expireInviteIfNeeded(ctx: MutationCtx, invite: { _id: Id<"alphaInvites">; expiresAt: number; expiredAt?: number }) {
  if (invite.expiresAt > Date.now()) return false;
  if (invite.expiredAt === undefined) {
    await ctx.db.patch(invite._id, {
      expiredAt: Date.now(),
      reservationEmailHash: undefined,
      reservationExpiresAt: undefined,
      reservationId: undefined,
    });
    await recordEvent(ctx, "inviteExpired", invite._id);
  }
  return true;
}

/** Called only from the password provider before a sign-up creates an account. */
export const reserveInvite = internalMutationGeneric({
  args: { emailHash: v.string(), tokenHash: v.string() },
  handler: async (ctx, { emailHash, tokenHash }) => {
    const invite = await ctx.db
      .query("alphaInvites")
      .withIndex("by_token_hash", (query) => query.eq("tokenHash", tokenHash))
      .unique();
    if (invite === null) {
      // Invalid values do not become audit records, avoiding an attacker-controlled log.
      throw new Error("A valid alpha invite is required.");
    }
    if (await expireInviteIfNeeded(ctx, invite)) {
      throw new Error("This alpha invite has expired.");
    }
    if (invite.claimedBy !== undefined) {
      await recordEvent(ctx, "inviteRejected", invite._id);
      throw new Error("This alpha invite is no longer available.");
    }
    if (invite.reservationExpiresAt !== undefined && invite.reservationExpiresAt > Date.now()) {
      await recordEvent(ctx, "inviteRejected", invite._id);
      throw new Error("This alpha invite is no longer available.");
    }

    const reservationId = crypto.randomUUID();
    await ctx.db.patch(invite._id, {
      reservationEmailHash: emailHash,
      reservationExpiresAt: Date.now() + reservationDurationMs,
      reservationId,
    });
    await recordEvent(ctx, "inviteReserved", invite._id);
    return { inviteId: invite._id, reservationId };
  },
});

/** Completes a reservation for a trusted account-creation flow. */
export const claimReservedInvite = internalMutationGeneric({
  args: {
    inviteId: v.id("alphaInvites"),
    reservationId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, { inviteId, reservationId, userId }) => {
    const invite = await ctx.db.get(inviteId);
    if (invite === null || await expireInviteIfNeeded(ctx, invite)) {
      throw new Error("This alpha invite has expired.");
    }
    if (invite.claimedBy !== undefined || invite.reservationId !== reservationId || invite.reservationExpiresAt === undefined || invite.reservationExpiresAt <= Date.now()) {
      if (invite !== null) await recordEvent(ctx, "inviteRejected", invite._id);
      throw new Error("This alpha invite is no longer available.");
    }
    await ctx.db.patch(inviteId, {
      claimedAt: Date.now(),
      claimedBy: userId,
      reservationExpiresAt: undefined,
      reservationEmailHash: undefined,
      reservationId: undefined,
    });
    await recordEvent(ctx, "inviteAccepted", inviteId);
  },
});

/** Operator-only invite issuance. Its secret must never enter browser code. */
export const issueInvite = actionGeneric({
  args: {
    adminKey: v.string(),
    expiresInMinutes: v.optional(v.number()),
  },
  handler: async (ctx, { adminKey, expiresInMinutes = 60 * 24 * 7 }) => {
    const configuredKey = process.env.ENROLLMENT_ADMIN_KEY;
    if (!configuredKey || !secureEquals(adminKey, configuredKey)) {
      throw new Error("Enrollment administration is unavailable.");
    }
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > maxInviteLifetimeMinutes) {
      throw new Error(`expiresInMinutes must be between 1 and ${maxInviteLifetimeMinutes}`);
    }
    const token = generateInviteToken();
    await ctx.runMutation((internal as any).enrollment.createInvite, {
      expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
      tokenHash: await inviteTokenHash(token),
    });
    // The raw token is returned once to the operator and is never persisted.
    return { expiresAt: Date.now() + expiresInMinutes * 60 * 1000, token };
  },
});

export const createInvite = internalMutationGeneric({
  args: { expiresAt: v.number(), tokenHash: v.string() },
  handler: async (ctx, { expiresAt, tokenHash }) => {
    const inviteId = await ctx.db.insert("alphaInvites", { createdAt: Date.now(), expiresAt, tokenHash });
    await recordEvent(ctx, "inviteIssued", inviteId);
    return inviteId;
  },
});

export async function requireEnrolledUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const invitation = await ctx.db
    .query("alphaInvites")
    .withIndex("by_claimed_by", (query) => query.eq("claimedBy", userId))
    .unique();
  if (invitation === null || invitation.expiredAt !== undefined) {
    throw new Error("Alpha enrollment required");
  }
}

export const status = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await requireVerifiedUser(ctx);
    const invitation = await ctx.db
      .query("alphaInvites")
      .withIndex("by_claimed_by", (query) => query.eq("claimedBy", userId))
      .unique();
    return { enrolled: invitation !== null && invitation.expiredAt === undefined };
  },
});
