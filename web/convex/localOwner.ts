import { v } from "convex/values";
import { betterAuth } from "better-auth/minimal";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAuthOptions } from "./auth";
import { reservationEmailHash, secureEquals } from "./enrollmentCore";

export function requireLocalOwnerSetup(adminKey: string) {
  const selected = process.env.AUTH_LOCAL_OWNER_SETUP;
  const site = process.env.SITE_URL;
  if (!selected?.startsWith("dev:") || !site || !process.env.ENROLLMENT_ADMIN_KEY ||
      !secureEquals(adminKey, process.env.ENROLLMENT_ADMIN_KEY)) throw new Error("Local owner setup is unavailable.");
  const origin = new URL(site);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      process.env.CONVEX_SITE_URL !== `https://${selected.slice(4)}.convex.site`) {
    throw new Error("Local owner setup requires the selected development deployment and a loopback site.");
  }
}

// Internal and transactional: concurrent setup requests cannot claim separate owners.
export const reserve = internalMutation({
  args: { emailHash: v.string() }, returns: v.null(),
  handler: async (ctx, { emailHash }) => {
    if ((await ctx.db.query("users").take(1)).length) throw new Error("An account already exists. Sign in instead.");
    const existing = await ctx.db.query("alphaInvites").withIndex("by_token_hash", q => q.eq("tokenHash", "local-owner-bootstrap")).unique();
    const now = Date.now();
    if (existing?.claimedBy || (existing?.reservationExpiresAt && existing.reservationExpiresAt > now && existing.reservationEmailHash !== emailHash)) {
      throw new Error("Owner setup is already in progress. Try again later.");
    }
    const reservation = { expiresAt: now + 600000, expiredAt: undefined, reservationExpiresAt: now + 600000,
      reservationEmailHash: emailHash, reservationId: crypto.randomUUID() };
    if (existing) await ctx.db.patch(existing._id, reservation);
    else await ctx.db.insert("alphaInvites", { ...reservation, createdAt: now, tokenHash: "local-owner-bootstrap" });
    return null;
  },
});

// The operator key stays in the loopback Vite middleware, never in browser code.
export const create = action({
  args: { adminKey: v.string(), email: v.string(), password: v.string() },
  returns: v.object({ created: v.literal(true) }),
  handler: async (ctx, { adminKey, email: rawEmail, password }) => {
    requireLocalOwnerSetup(adminKey);
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        password.length < 12 || password.length > 128 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      throw new Error("Use an email address and a password of 12–128 characters with a letter and number.");
    }
    await ctx.runMutation(internal.localOwner.reserve, { emailHash: await reservationEmailHash(email) });
    const defaults = createAuthOptions(ctx);
    const auth = betterAuth({ ...defaults,
      emailAndPassword: { ...defaults.emailAndPassword, requireEmailVerification: false },
      emailVerification: undefined, hooks: undefined,
      databaseHooks: { user: { create: { before: async user => ({ data: { ...user, emailVerified: true } }) } } },
    });
    await auth.api.signUpEmail({ body: { email, password, name: email.split("@")[0] },
      headers: new Headers({ origin: process.env.SITE_URL! }) });
    return { created: true as const };
  },
});
