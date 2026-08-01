import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Value } from "convex/values";

function publicEmailProfile(params: Record<string, Value | undefined>) {
  const email = String(params.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }

  return { email };
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: publicEmailProfile,
      validatePasswordRequirements(password) {
        if (password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
          throw new Error("Use at least 12 characters, including a letter and a number");
        }
      },
    }),
  ],
});
