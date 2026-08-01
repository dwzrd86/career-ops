import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Resend from "@auth/core/providers/resend";
import { Value } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

function publicEmailProfile(params: Record<string, Value | undefined>) {
  const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }

  return { email };
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
  providers: [
    Password({
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
