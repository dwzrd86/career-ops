import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { createAuthMiddleware } from "better-auth/api";
import { DataModel } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import authConfig from "./auth.config";
import { inviteTokenHash, reservationEmailHash } from "./enrollmentCore";

type AbuseAction = "signUp" | "passwordReset" | "resendVerification";
type SecurityEnvironment =
  | "AUTH_ABUSE_KEY"
  | "AUTH_RESEND_FROM"
  | "AUTH_RESEND_KEY"
  | "AUTH_TURNSTILE_HOSTNAME"
  | "AUTH_TURNSTILE_SECRET"
  | "CONVEX_SITE_URL"
  | "SITE_URL";

const reservationDurationMs = 10 * 60 * 1000;

function requiredSecurityEnvironment(name: SecurityEnvironment) {
  const value = process.env[name];
  if (!value) throw new Error("Authentication temporarily unavailable. Please try again later.");
  return value;
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  return email;
}

function validatePassword(password: unknown) {
  if (typeof password !== "string" || password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw new Error("Use at least 12 characters, including a letter and a number");
  }
}

function requireAccountLifecycleConfiguration(flow: "signUp" | "passwordReset" | "resendVerification" | "verification") {
  for (const name of ["AUTH_ABUSE_KEY", "AUTH_RESEND_FROM", "AUTH_RESEND_KEY", "CONVEX_SITE_URL", "SITE_URL"] as const) {
    requiredSecurityEnvironment(name);
  }
  if (flow === "signUp") {
    requiredSecurityEnvironment("AUTH_TURNSTILE_HOSTNAME");
    requiredSecurityEnvironment("AUTH_TURNSTILE_SECRET");
  }
}

async function privacyPreservingKey(email: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredSecurityEnvironment("AUTH_ABUSE_KEY")),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifySignupBotToken(token: unknown) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new Error("Authentication temporarily unavailable. Please try again later.");
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    body: JSON.stringify({ response: token, secret: requiredSecurityEnvironment("AUTH_TURNSTILE_SECRET") }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof result !== "object" || result === null || (result as { success?: unknown }).success !== true) {
    throw new Error("Authentication temporarily unavailable. Please try again later.");
  }
  const expectedHostname = requiredSecurityEnvironment("AUTH_TURNSTILE_HOSTNAME");
  const { action, hostname } = result as { action?: unknown; hostname?: unknown };
  if (hostname !== expectedHostname || (action !== undefined && action !== "signup")) {
    throw new Error("Authentication temporarily unavailable. Please try again later.");
  }
}

async function consumeAbuseLimit(ctx: GenericCtx<DataModel>, action: AbuseAction, email: string) {
  await requireActionCtx(ctx).runMutation(internal.abuse.consume, { action, key: await privacyPreservingKey(email) });
}

async function sendAuthenticationEmail(ctx: GenericCtx<DataModel>, to: string, subject: string, text: string) {
  requireAccountLifecycleConfiguration("verification");
  requireActionCtx(ctx);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({ from: requiredSecurityEnvironment("AUTH_RESEND_FROM"), subject, text, to: [to] }),
    headers: {
      Authorization: `Bearer ${requiredSecurityEnvironment("AUTH_RESEND_KEY")}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error("Could not send authentication email");
}

async function claimReservedInvite(ctx: MutationCtx, email: string, userId: Id<"users">) {
  const emailHash = await reservationEmailHash(email);
  const invite = await ctx.db
    .query("alphaInvites")
    .withIndex("by_reservation_email", (query) => query.eq("reservationEmailHash", emailHash))
    .unique();
  const now = Date.now();
  if (invite === null || invite.claimedBy !== undefined || invite.expiresAt <= now || invite.reservationExpiresAt === undefined || invite.reservationExpiresAt <= now) {
    throw new Error("A valid alpha invite is required.");
  }
  await ctx.db.patch(invite._id, {
    claimedAt: now,
    claimedBy: userId,
    reservationEmailHash: undefined,
    reservationExpiresAt: undefined,
    reservationId: undefined,
  });
  await ctx.db.insert("enrollmentAuditEvents", { event: "inviteAccepted", inviteId: invite._id, occurredAt: now });
}

export const authComponent: ReturnType<typeof createClient<DataModel>> = createClient<DataModel>(components.betterAuth as any, {
  // The generated internal API is refreshed after this component is first deployed.
  authFunctions: internal.auth as any,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_auth_id", (query) => query.eq("authId", authUser._id))
          .unique();
        if (existing !== null) return;
        const userId = await ctx.db.insert("users", { authId: authUser._id });
        await claimReservedInvite(ctx, authUser.email, userId);
      },
      onDelete: async (ctx, authUser) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_auth_id", (query) => query.eq("authId", authUser._id))
          .unique();
        if (user === null) return;
        const jobs = await ctx.db
          .query("jobs")
          .withIndex("by_owner_created_at", (query) => query.eq("ownerId", user._id))
          .collect();
        for (const job of jobs) await ctx.db.delete(job._id);
        const invite = await ctx.db
          .query("alphaInvites")
          .withIndex("by_claimed_by", (query) => query.eq("claimedBy", user._id))
          .unique();
        if (invite !== null) {
          await ctx.db.patch(invite._id, { claimedBy: undefined, expiredAt: Date.now() });
        }
        await ctx.db.insert("accountPrivacyEvents", { action: "accountDeleted", occurredAt: Date.now(), userId: user._id });
        await ctx.db.delete(user._id);
      },
    },
  },
});

export const { onCreate, onDelete, onUpdate } = authComponent.triggersApi();

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = requiredSecurityEnvironment("SITE_URL");
  return {
    baseURL: requiredSecurityEnvironment("CONVEX_SITE_URL"),
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthenticationEmail(ctx, user.email, "Reset your Jobbie password", `Use this link to reset your Jobbie password. It expires in 15 minutes:\n${url}`);
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: 15 * 60,
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthenticationEmail(ctx, user.email, "Verify your Jobbie email", `Verify your Jobbie email address within 15 minutes:\n${url}`);
      },
    },
    user: { deleteUser: { enabled: true } },
    hooks: {
      before: createAuthMiddleware(async (request) => {
        const body = request.body as Record<string, unknown> | undefined;
        if (!body) return;
        if (request.path === "/sign-up/email") {
          const email = normalizeEmail(body.email);
          validatePassword(body.password);
          requireAccountLifecycleConfiguration("signUp");
          await verifySignupBotToken(body.botProtectionToken);
          await consumeAbuseLimit(ctx, "signUp", email);
          await requireActionCtx(ctx).runMutation(internal.enrollment.reserveInvite, {
            emailHash: await reservationEmailHash(email),
            tokenHash: await inviteTokenHash(body.inviteToken),
          });
        }
        if (request.path === "/request-password-reset") {
          const email = normalizeEmail(body.email);
          requireAccountLifecycleConfiguration("passwordReset");
          await consumeAbuseLimit(ctx, "passwordReset", email);
        }
        if (request.path === "/send-verification-email") {
          const email = normalizeEmail(body.email);
          requireAccountLifecycleConfiguration("resendVerification");
          await consumeAbuseLimit(ctx, "resendVerification", email);
        }
      }),
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

/** Require an authenticated, verified Better Auth user mapped to app-owned data. */
export async function requireVerifiedUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (authUser === undefined) throw new Error("Authentication required");
  if (!authUser.emailVerified) throw new Error("Email verification required");
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_id", (query) => query.eq("authId", authUser._id))
    .unique();
  if (user === null) throw new Error("Authentication required");
  return user._id;
}
