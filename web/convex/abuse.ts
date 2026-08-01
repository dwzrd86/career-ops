import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const limits = {
  passwordReset: 5,
  resendVerification: 5,
  signUp: 5,
} as const;

const oneHourMs = 60 * 60 * 1000;

export const consume = internalMutation({
  args: {
    action: v.union(
      v.literal("passwordReset"),
      v.literal("resendVerification"),
      v.literal("signUp"),
    ),
    key: v.string(),
  },
  handler: async (ctx, { action, key }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("authAbuseLimits")
      .withIndex("by_key_and_action", (query) => query.eq("key", key).eq("action", action))
      .unique();

    if (existing === null || now - existing.windowStartedAt >= oneHourMs) {
      if (existing !== null) {
        await ctx.db.patch(existing._id, { attempts: 1, windowStartedAt: now });
      } else {
        await ctx.db.insert("authAbuseLimits", { action, attempts: 1, key, windowStartedAt: now });
      }
      return;
    }

    if (existing.attempts >= limits[action]) {
      throw new Error("Authentication temporarily unavailable. Please try again later.");
    }

    await ctx.db.patch(existing._id, { attempts: existing.attempts + 1 });
  },
});
