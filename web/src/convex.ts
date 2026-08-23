import { makeFunctionReference } from "convex/server";

export type JobStatus =
  | "discovered"
  | "evaluated"
  | "applied"
  | "interview"
  | "offer"
  | "rejected"
  | "discarded";

export type Job = {
  _id: string;
  _creationTime: number;
  company: string;
  title: string;
  location: string;
  url: string;
  source: string;
  status: JobStatus;
  score?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};

export type DiscoveryDecisionOutcome = "rejected" | "ranked" | "needsReview";
export type DiscoveryReviewStatus = "discovered" | "shortlisted" | "archived" | "approvedForEvaluation";
export type DiscoveryFreshnessStatus = "fresh" | "stale" | "unknown" | "expired";
export type DiscoveryHardFilterOutcome = "pass" | "fail" | "unknown" | "notApplicable";
export type MaterialReviewState = "draftAwaitingReview" | "approved" | "changesRequested" | "rejected";

export type DiscoveredJob = {
  _id: string;
  _creationTime: number;
  company: string;
  discoveredAt: number;
  freshness: {
    checkedAt: number;
    postedAt?: number;
    status: DiscoveryFreshnessStatus;
  };
  location?: string;
  localJobId: string;
  materialStatus?: {
    artifacts: { checklistReady: boolean; pdfReady: boolean; reportReady: boolean };
    createdAt: number;
    reviewState: MaterialReviewState;
    targetProfileVersion: number;
  };
  reviewStatus: DiscoveryReviewStatus;
  source: { label: string; provider: string };
  title: string;
  updatedAt: number;
  url: string;
  decision: {
    decidedAt: number;
    explanationCodes: string[];
    hardFilters: Array<{
      outcome: DiscoveryHardFilterOutcome;
      reasonCode: string;
      ruleId: string;
    }>;
    outcome: DiscoveryDecisionOutcome;
    profileVersion: number;
    score?: number;
  } | null;
  effectiveOutcome: DiscoveryDecisionOutcome | null;
  override: {
    outcome: DiscoveryDecisionOutcome;
    overriddenAt: number;
    reason: string;
  } | null;
};

export type PrivacyStatus = {
  acknowledgedAt: number | null;
  currentVersion: string;
  requiresAcknowledgement: boolean;
};

export type EnrollmentStatus = {
  enrolled: boolean;
};

export type AccountExport = {
  discovery: Array<{
    id: string;
    company: string;
    discoveredAt: number;
    freshness: DiscoveredJob["freshness"];
    localJobId: string;
    location?: string;
    materialStatus?: DiscoveredJob["materialStatus"];
    matchDecisions: Array<NonNullable<DiscoveredJob["decision"]> & { id: string }>;
    reviewerOverrides: Array<NonNullable<DiscoveredJob["override"]> & { id: string }>;
    reviewStatus: DiscoveryReviewStatus;
    source: DiscoveredJob["source"];
    statusHistory: Array<{ id: string; occurredAt: number; previousStatus?: DiscoveryReviewStatus; status: DiscoveryReviewStatus }>;
    title: string;
    updatedAt: number;
    url: string;
  }>;
  exportedAt: string;
  format: string;
  jobs: Array<Omit<Job, "_id" | "_creationTime"> & { id: string }>;
  privacy: { acknowledgedAt: string; policyVersion: string | null } | null;
};

export const functions = {
  acknowledgePrivacy: makeFunctionReference<"mutation", Record<string, never>, null>("privacy:acknowledge"),
  exportAccountData: makeFunctionReference<"query", Record<string, never>, AccountExport>("account:exportData"),
  recordAccountExport: makeFunctionReference<"mutation", Record<string, never>, null>("account:recordExportRequest"),
  reportClientError: makeFunctionReference<
    "mutation",
    {
      deploymentVersion: string;
      errorCategory: "authenticationFailed" | "operationFailed" | "unexpected" | "validationFailed";
      operationType: string;
      route: string;
    },
    null
  >("errorReporting:reportClient"),
  listJobs: makeFunctionReference<"query", Record<string, never>, Job[]>("jobs:list"),
  listDiscoveredJobs: makeFunctionReference<"query", Record<string, never>, DiscoveredJob[]>("discovery:list"),
  getPrivacyStatus: makeFunctionReference<"query", Record<string, never>, PrivacyStatus>("privacy:status"),
  getEnrollmentStatus: makeFunctionReference<"query", Record<string, never>, EnrollmentStatus>("enrollment:status"),
  createJob: makeFunctionReference<
    "mutation",
    {
      company: string;
      title: string;
      location: string;
      url: string;
      source: string;
      notes?: string;
    },
    string
  >("jobs:create"),
  updateJobStatus: makeFunctionReference<
    "mutation",
    { id: string; status: JobStatus },
    null
  >("jobs:updateStatus"),
  removeJob: makeFunctionReference<"mutation", { id: string }, null>("jobs:remove"),
  shortlistDiscoveredJob: makeFunctionReference<"mutation", { id: string }, null>("discovery:shortlist"),
  archiveDiscoveredJob: makeFunctionReference<"mutation", { id: string }, null>("discovery:archive"),
  approveDiscoveredJobForEvaluation: makeFunctionReference<"mutation", { id: string }, null>("discovery:approveForEvaluation"),
  overrideDiscoveredJobDecision: makeFunctionReference<
    "mutation",
    { id: string; outcome: DiscoveryDecisionOutcome; reason: string },
    null
  >("discovery:overrideDecision"),
};
