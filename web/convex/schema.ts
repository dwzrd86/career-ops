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

const discoverySourceProvider = v.union(
  v.literal("greenhouse"),
  v.literal("ashby"),
  v.literal("lever"),
  v.literal("interceptor"),
  v.literal("manual"),
);

const discoveryFreshness = v.union(
  v.literal("fresh"),
  v.literal("stale"),
  v.literal("unknown"),
  v.literal("expired"),
);

const discoveryReviewStatus = v.union(
  v.literal("discovered"),
  v.literal("shortlisted"),
  v.literal("archived"),
  v.literal("approvedForEvaluation"),
);

const discoveryDecisionOutcome = v.union(
  v.literal("rejected"),
  v.literal("ranked"),
  v.literal("needsReview"),
);

const hardFilterOutcome = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("unknown"),
  v.literal("notApplicable"),
);

const materialReviewState = v.union(
  v.literal("draftAwaitingReview"),
  v.literal("approved"),
  v.literal("changesRequested"),
  v.literal("rejected"),
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
  // Local discovery records remain canonical. This is a deliberately narrow,
  // owner-scoped projection for the private review UI: no resume/JD content,
  // browser data, local paths, or component-auth records are stored here.
  discoveredJobs: defineTable({
    ownerId: v.id("users"),
    localJobId: v.string(),
    company: v.string(),
    title: v.string(),
    location: v.optional(v.string()),
    url: v.string(),
    source: v.object({
      label: v.string(),
      provider: discoverySourceProvider,
    }),
    freshness: v.object({
      checkedAt: v.number(),
      postedAt: v.optional(v.number()),
      status: discoveryFreshness,
    }),
    reviewStatus: discoveryReviewStatus,
    // Read-only local Material Bundle progress. Artifact paths and all career
    // content stay local and are never part of this hosted projection.
    materialStatus: v.optional(v.object({
      artifacts: v.object({
        checklistReady: v.boolean(),
        pdfReady: v.boolean(),
        reportReady: v.boolean(),
      }),
      createdAt: v.number(),
      reviewState: materialReviewState,
      targetProfileVersion: v.number(),
    })),
    discoveredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_local_job", ["ownerId", "localJobId"])
    .index("by_owner_discovered_at", ["ownerId", "discoveredAt"])
    .index("by_owner_review_status", ["ownerId", "reviewStatus"]),
  discoveryMatchDecisions: defineTable({
    ownerId: v.id("users"),
    discoveredJobId: v.id("discoveredJobs"),
    profileVersion: v.number(),
    outcome: discoveryDecisionOutcome,
    score: v.optional(v.number()),
    hardFilters: v.array(v.object({
      outcome: hardFilterOutcome,
      reasonCode: v.string(),
      ruleId: v.string(),
    })),
    explanationCodes: v.array(v.string()),
    decidedAt: v.number(),
  }).index("by_owner_job_decided_at", ["ownerId", "discoveredJobId", "decidedAt"]),
  discoveryStatusHistory: defineTable({
    ownerId: v.id("users"),
    discoveredJobId: v.id("discoveredJobs"),
    previousStatus: v.optional(discoveryReviewStatus),
    status: discoveryReviewStatus,
    occurredAt: v.number(),
  }).index("by_owner_job_occurred_at", ["ownerId", "discoveredJobId", "occurredAt"]),
  discoveryReviewerOverrides: defineTable({
    ownerId: v.id("users"),
    discoveredJobId: v.id("discoveredJobs"),
    baseDecisionId: v.optional(v.id("discoveryMatchDecisions")),
    outcome: discoveryDecisionOutcome,
    reason: v.string(),
    overriddenAt: v.number(),
  }).index("by_owner_job_overridden_at", ["ownerId", "discoveredJobId", "overriddenAt"]),
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
