import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { PasswordConfig } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import Resend from "@auth/core/providers/resend";
import {
  createAccount,
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
  signInViaProvider,
} from "@convex-dev/auth/server";
import { GenericDataModel } from "convex/server";
import { Value } from "convex/values";
import { Scrypt } from "lucia";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

function publicEmailProfile(params: Record<string, Value | undefined>) {
  const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }

  return { email };
}

type AbuseAction = "signUp" | "passwordReset" | "resendVerification";

function requiredSecurityEnvironment(name: "AUTH_ABUSE_KEY" | "AUTH_TURNSTILE_SECRET") {
  const value = process.env[name];
  if (!value) {
    throw new Error("Authentication temporarily unavailable. Please try again later.");
  }
  return value;
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
    body: JSON.stringify({
      response: token,
      secret: requiredSecurityEnvironment("AUTH_TURNSTILE_SECRET"),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !isExpectedTurnstileResponse(result)) {
    throw new Error("Authentication temporarily unavailable. Please try again later.");
  }
}

function isExpectedTurnstileResponse(value: unknown): value is { action?: string; hostname?: string; success: true } {
  if (typeof value !== "object" || value === null || (value as { success?: unknown }).success !== true) {
    return false;
  }
  const expectedHostname = process.env.AUTH_TURNSTILE_HOSTNAME;
  return (!expectedHostname || (value as { hostname?: unknown }).hostname === expectedHostname)
    && (!(value as { action?: unknown }).action || (value as { action?: unknown }).action === "signup");
}

async function enforceAbuseControls(
  params: Record<string, Value | undefined>,
  email: string,
  ctx: GenericActionCtxWithAuthConfig<GenericDataModel>,
) {
  const flow = params.flow;
  let action: AbuseAction | null = null;

  if (flow === "signUp") {
    await verifySignupBotToken(params.botProtectionToken);
    action = "signUp";
  } else if (flow === "reset") {
    action = "passwordReset";
  } else if (flow === "email-verification" && params.code === undefined) {
    action = "resendVerification";
  }

  if (action !== null) {
    await ctx.runMutation((internal as any).abuse.consume, {
      action,
      key: await privacyPreservingKey(email),
    });
  }
}

/**
 * Convex Auth's Password provider does not offer a hook before account creation.
 * This preserves its supported password, reset, and verification implementation
 * while ensuring every externally initiated flow crosses the backend abuse gate.
 */
function AbuseProtectedPassword<DataModel extends GenericDataModel>(config: PasswordConfig<DataModel>) {
  const provider = config.id ?? "password";
  return ConvexCredentials<DataModel>({
    id: provider,
    authorize: async (params, ctx) => {
      const flow = params.flow as string;
      const passwordToValidate = flow === "signUp"
        ? params.password as string
        : flow === "reset-verification"
          ? params.newPassword as string
          : null;
      if (passwordToValidate !== null) {
        config.validatePasswordRequirements?.(passwordToValidate);
      }

      const profile = config.profile?.(params, ctx) ?? publicEmailProfile(params);
      await enforceAbuseControls(params, profile.email, ctx);
      const email = profile.email;

      if (flow === "signUp") {
        const secret = params.password as string;
        if (secret === undefined) throw new Error("Authentication temporarily unavailable. Please try again later.");
        const { account, user } = await createAccount(ctx, {
          account: { id: email, secret },
          profile: profile as any,
          provider,
          shouldLinkViaEmail: config.verify !== undefined,
          shouldLinkViaPhone: false,
        });
        if (config.verify && !account.emailVerified) {
          return await signInViaProvider(ctx, config.verify, { accountId: account._id, params });
        }
        return { userId: user._id };
      }

      if (flow === "signIn") {
        const secret = params.password as string;
        if (secret === undefined) throw new Error("Authentication temporarily unavailable. Please try again later.");
        const retrieved = await retrieveAccount(ctx, { account: { id: email, secret }, provider });
        if (retrieved === null) throw new Error("Authentication temporarily unavailable. Please try again later.");
        if (config.verify && !retrieved.account.emailVerified) {
          return await signInViaProvider(ctx, config.verify, { accountId: retrieved.account._id, params });
        }
        return { userId: retrieved.user._id };
      }

      if (flow === "reset") {
        if (!config.reset) throw new Error("Authentication temporarily unavailable. Please try again later.");
        const { account } = await retrieveAccount(ctx, { account: { id: email }, provider });
        return await signInViaProvider(ctx, config.reset, { accountId: account._id, params });
      }

      if (flow === "reset-verification") {
        if (!config.reset || params.newPassword === undefined) throw new Error("Authentication temporarily unavailable. Please try again later.");
        const { account } = await retrieveAccount(ctx, { account: { id: email }, provider });
        const result = await signInViaProvider(ctx, config.reset, { params });
        if (result === null || account.userId !== result.userId) throw new Error("Authentication temporarily unavailable. Please try again later.");
        await modifyAccountCredentials(ctx, { account: { id: email, secret: params.newPassword as string }, provider });
        await invalidateSessions(ctx, { except: [result.sessionId], userId: result.userId });
        return result;
      }

      if (flow === "email-verification") {
        if (!config.verify) throw new Error("Authentication temporarily unavailable. Please try again later.");
        const { account } = await retrieveAccount(ctx, { account: { id: email }, provider });
        return await signInViaProvider(ctx, config.verify, { accountId: account._id, params });
      }

      throw new Error("Authentication temporarily unavailable. Please try again later.");
    },
    crypto: {
      async hashSecret(password: string) {
        return await new Scrypt().hash(password);
      },
      async verifySecret(password: string, hash: string) {
        return await new Scrypt().verify(hash, password);
      },
    },
    extraProviders: [config.reset, config.verify] as (EmailConfig | undefined)[],
  });
}

function createEmailOtpProvider(id: string, subject: string) {
  return Resend({
    id,
    apiKey: process.env.AUTH_RESEND_KEY,
    from: process.env.AUTH_RESEND_FROM,
    maxAge: 15 * 60,
    async generateVerificationToken() {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      return String(bytes[0] % 100_000_000).padStart(8, "0");
    },
    async sendVerificationRequest({ identifier, provider, token }) {
      if (!provider.apiKey || !provider.from) {
        throw new Error("Transactional email is not configured");
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: provider.from,
          to: [identifier],
          subject,
          text: `Your Jobbie ${subject.toLowerCase()} code is ${token}. It expires in 15 minutes.`,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not send verification email");
      }
    },
  });
}

const passwordReset = createEmailOtpProvider("resend-password-reset", "password reset");
const emailVerification = createEmailOtpProvider("resend-email-verification", "email verification");

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  signIn: {
    // Convex Auth records actual failed password checks against an opaque account ID.
    maxFailedAttempsPerHour: 5,
  },
  providers: [
    AbuseProtectedPassword({
      profile: publicEmailProfile,
      reset: passwordReset,
      verify: emailVerification,
      validatePasswordRequirements(password) {
        if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
          throw new Error("Use at least 12 characters, including a letter and a number");
        }
      },
    }),
  ],
});

/** Identity policy for application data: an authenticated password account must verify its address. */
export async function requireVerifiedUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Authentication required");
  }

  const passwordAccount = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (query) => query.eq("userId", userId).eq("provider", "password"))
    .unique();

  if (passwordAccount?.emailVerified === undefined) {
    throw new Error("Email verification required");
  }
  return userId;
}
