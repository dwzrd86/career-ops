import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  // Application-owned account metadata. Authentication credentials and sessions
  // are isolated in the Better Auth component; authId is its stable user id.
  users: defineTable({
    authId: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    privacyAcknowledgedAt: v.optional(v.number()),
    privacyPolicyVersion: v.optional(v.string()),
  }).index("by_auth_id", ["authId"]),
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
  // Alpha access is granted with an opaque invite token. Only an HMAC digest
  // is persisted; neither the raw token nor an invitee email is stored here.
  alphaInvites: defineTable({
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimedBy: v.optional(v.id("users")),
    expiredAt: v.optional(v.number()),
    reservationId: v.optional(v.string()),
    reservationEmailHash: v.optional(v.string()),
    reservationExpiresAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_reservation_email", ["reservationEmailHash"])
    .index("by_claimed_by", ["claimedBy"]),
  // Audit records intentionally omit email addresses, raw tokens, IP
  // addresses, and career content. They support operational investigation
  // without becoming another source of account-profile data.
  enrollmentAuditEvents: defineTable({
    event: v.union(
      v.literal("inviteIssued"),
      v.literal("inviteReserved"),
      v.literal("inviteAccepted"),
      v.literal("inviteExpired"),
      v.literal("inviteRejected"),
    ),
    inviteId: v.optional(v.id("alphaInvites")),
    occurredAt: v.number(),
  }).index("by_invite", ["inviteId"]),
  // Metadata-only operational diagnostics. This table intentionally has no
  // user ID, message, stack trace, request body, URL query, or content field.
  errorReports: defineTable({
    deploymentVersion: v.string(),
    errorCategory: v.union(
      v.literal("authenticationFailed"),
      v.literal("operationFailed"),
      v.literal("unexpected"),
      v.literal("validationFailed"),
    ),
    operationType: v.string(),
    route: v.string(),
    occurredAt: v.number(),
  }).index("by_occurred_at", ["occurredAt"]),
  accountPrivacyEvents: defineTable({
    action: v.union(v.literal("exportRequested"), v.literal("accountDeleted")),
    occurredAt: v.number(),
    userId: v.id("users"),
  }).index("by_user", ["userId"]),
});
