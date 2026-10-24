import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { attemptState, priceFields } from "./aiBudgetModel";
import { targetProfileFields } from "./targetProfileModel";

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
  targetProfiles: defineTable({
    ownerId: v.id("users"),
    ...targetProfileFields,
    profileVersion: v.number(),
    updatedAt: v.number(),
    lastScanAt: v.optional(v.number()),
  }).index("by_owner", ["ownerId"])
    .index("by_enabled", ["enabled"]),
  discoveryScanRuns: defineTable({
    ownerId: v.id("users"),
    profileVersion: v.number(),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("partial"), v.literal("failed")),
    queuedAt: v.number(),
    finishedAt: v.optional(v.number()),
    feedsSucceeded: v.number(),
    feedsFailed: v.number(),
    discovered: v.number(),
    reviewable: v.number(),
    rejected: v.number(),
    errorCode: v.optional(v.string()),
  }).index("by_owner_queued_at", ["ownerId", "queuedAt"]),
  jobs: defineTable({
    ownerId: v.id("users"),
    company: v.string(),
    title: v.string(),
    location: v.string(),
    url: v.string(),
    source: v.string(),
    postingText: v.optional(v.string()),
    status: jobStatus,
    score: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"])
    .index("by_owner_url", ["ownerId", "url"])
    .index("by_owner_created_at", ["ownerId", "createdAt"]),
  resumeBundles: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    sourceResume: v.string(),
    description: v.string(),
    resume: v.string(),
    revision: v.number(),
    reviewedAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  }).index("by_owner_job", ["ownerId", "jobId"]),
  // Content stays in the existing bundle. Exact bundle identity + revision bind
  // consent and completion to the saved evidence, including delete/recreate.
  hostedResumeRequests: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    bundleId: v.id("resumeBundles"),
    bundleRevision: v.number(),
    company: v.string(),
    title: v.string(),
    provider: v.literal("zai"),
    model: v.literal("glm-4.7"),
    consentVersion: v.string(),
    consentedAt: v.number(),
    privacyPolicyVersion: v.string(),
    status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
    failureCode: v.optional(v.union(
      v.literal("staleEvidence"), v.literal("accessRevoked"),
      v.literal("invalidDraft"), v.literal("providerFailed"),
      v.literal("providerBalance"), v.literal("providerRateLimited"),
      v.literal("providerOverloaded"), v.literal("providerTimeout"),
      v.literal("unavailable"),
    )),
  }).index("by_owner_status", ["ownerId", "status"])
    .index("by_owner_job", ["ownerId", "jobId"])
    .index("by_owner_bundle", ["ownerId", "bundleId"]),
  // Durable billing metadata only. Never delete unresolved liabilities with
  // career data; they remain chargeable to their original UTC month.
  aiBudgetControl: defineTable({
    key: v.literal("shared"), enabled: v.boolean(), cutoffMicroUsd: v.number(),
    unresolvedMicroUsd: v.number(), pilotCount: v.number(),
    activeAttemptId: v.optional(v.id("aiBudgetAttempts")),
  }).index("by_key", ["key"]),
  aiBudgetPrices: defineTable(priceFields).index("by_provider_model", ["provider", "model"]),
  aiPilotOwners: defineTable({
    ownerId: v.id("users"), active: v.boolean(), updatedAt: v.number(),
    activeAttemptId: v.optional(v.id("aiBudgetAttempts")),
  }).index("by_owner", ["ownerId"]),
  aiBudgetMonths: defineTable({
    month: v.string(), settledMicroUsd: v.number(), reservedMicroUsd: v.number(),
  }).index("by_month", ["month"]),
  aiOwnerMonths: defineTable({
    ownerId: v.id("users"), month: v.string(), attempts: v.number(),
  }).index("by_owner_month", ["ownerId", "month"]),
  // Account deletion detaches ownerId but preserves charge/idempotency evidence.
  aiBudgetAttempts: defineTable({
    ownerId: v.optional(v.id("users")), requestId: v.id("hostedResumeRequests"), month: v.string(),
    ...priceFields,
    reservedMicroUsd: v.number(), state: attemptState, createdAt: v.number(),
    dispatchedAt: v.optional(v.number()), settledAt: v.optional(v.number()),
    billedMicroUsd: v.optional(v.number()),
  }).index("by_request", ["requestId"]).index("by_owner", ["ownerId"]),
  // Local discovery records remain canonical. This is a deliberately narrow,
  // owner-scoped projection for the private review UI: no resume content,
  // browser data, local paths, or component-auth records are stored here.
  discoveredJobs: defineTable({
    ownerId: v.id("users"),
    localJobId: v.string(),
    // Public ATS plain text only, supplied by the internal feed worker.
    postingText: v.optional(v.string()),
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
    .index("by_owner_url", ["ownerId", "url"])
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
  // Deletion events retain action/time only; owner-linked export history is erased.
  accountPrivacyEvents: defineTable({
    action: v.union(v.literal("exportRequested"), v.literal("accountDeleted")),
    occurredAt: v.number(),
    userId: v.optional(v.id("users")),
  }).index("by_user", ["userId"]),
});
