import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const jobStatus = v.union(
  v.literal("discovered"),
  v.literal("evaluated"),
  v.literal("applied"),
  v.literal("interview"),
  v.literal("offer"),
  v.literal("rejected"),
  v.literal("discarded"),
);

export default defineSchema({
  ...authTables,
  // Keep acknowledgement metadata with the authenticated account rather than
  // duplicating identity data or a copy of the policy in a separate table.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    privacyAcknowledgedAt: v.optional(v.number()),
    privacyPolicyVersion: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  jobs: defineTable({
    ownerId: v.id("users"),
    company: v.string(),
    title: v.string(),
    location: v.string(),
    url: v.string(),
    source: v.string(),
    status: jobStatus,
    score: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"])
    .index("by_owner_created_at", ["ownerId", "createdAt"]),
  // This table intentionally stores an HMAC-derived address key, never an email address.
  authAbuseLimits: defineTable({
    action: v.union(
      v.literal("passwordReset"),
      v.literal("resendVerification"),
      v.literal("signUp"),
    ),
    attempts: v.number(),
    key: v.string(),
    windowStartedAt: v.number(),
  }).index("by_key_and_action", ["key", "action"]),
});
