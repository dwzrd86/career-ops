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
  postingText?: string;
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
export type TargetProfileInput = {
  targetRoles: Array<{ title: string; aliases: string[]; seniority: string[] }>;
  home: string;
  radiusMiles?: number;
  workplaceModes: Array<"remote" | "hybrid" | "onsite">;
  allowedRegions: string[];
  preferredRegions: string[];
  dreamRegions: string[];
  dreamIndustries: string[];
  excludedCompanies: string[];
  excludedIndustries: string[];
  frameworks: string[];
  cloudPlatforms: string[];
  salaryFloor?: number;
  currency: string;
  workAuthorization: string[];
  clearanceLevels: string[];
  maxTravelPercent?: number;
  maxOfficeDaysPerWeek?: number;
  sources: Array<"greenhouse" | "ashby" | "lever">;
  schedule: "manual" | "daily" | "weekdays";
  enabled: boolean;
};
export type TargetProfile = TargetProfileInput & { profileVersion: number; updatedAt: number; lastScanAt?: number };
export type DiscoveryScanRun = {
  _id: string;
  profileVersion: number;
  trigger: "manual" | "scheduled";
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  queuedAt: number;
  finishedAt?: number;
  feedsSucceeded: number;
  feedsFailed: number;
  discovered: number;
  reviewable: number;
  rejected: number;
  errorCode?: string;
};
export type MaterialReviewState = "draftAwaitingReview" | "approved" | "changesRequested" | "rejected";

export type DiscoveredJob = {
  postingText?: string;
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

export type ResumeBundle = {
  jobId: string;
  sourceResume: string;
  description: string;
  resume: string;
  revision: number;
  reviewedAt: number | null;
  updatedAt: number;
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
    postingText?: string;
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
  resumeBundles?: Array<ResumeBundle & { id: string }>;
  exportedAt: string;
  format: string;
  jobs: Array<Omit<Job, "_id" | "_creationTime"> & { id: string }>;
  targetProfile?: (TargetProfile & { id: string }) | null;
  discoveryScanRuns?: Array<Omit<DiscoveryScanRun, "_id"> & { id: string }>;
  privacy: { acknowledgedAt: string; policyVersion: string | null } | null;
};

export type HostedResumeStatus = {
  requestId: string; jobId: string; bundleRevision: number;
  status: "pending" | "succeeded" | "failed"; failureCode?: string;
};
export const functions = {
  requestHostedResume: makeFunctionReference<"mutation", { jobId: string; expectedRevision: number;
    consent: { provider: "zai"; model: "glm-4.7"; version: string; shareSelectedEvidence: boolean } }, string>("hostedResumes:request"),
  hostedResumeStatus: makeFunctionReference<"query", { requestId: string }, HostedResumeStatus | null>("hostedResumes:status"),
  hostedResumeAvailability: makeFunctionReference<"query", Record<string, never>, {
    remaining: number; pending: boolean; reason: "ready" | "quota" | "budget" | "unavailable";
  }>("hostedResumes:availability"),
  listResumeSummaries: makeFunctionReference<"query", Record<string, never>, Array<{ jobId: string; revision: number; reviewedAt: number | null; updatedAt: number }>>("resumeBundles:summaries"),
  listResumeSources: makeFunctionReference<"query", Record<string, never>, Array<{ jobId: string; company: string; title: string; sourceResume: string; updatedAt: number }>>("resumeBundles:sources"),
  getResumeBundle: makeFunctionReference<"query", { jobId: string }, ResumeBundle | null>("resumeBundles:get"),
  saveResumeBundle: makeFunctionReference<"mutation", {
    jobId: string; sourceResume: string; description: string; resume: string;
    reviewed: boolean; expectedRevision: number | null;
  }, number>("resumeBundles:save"),
  removeResumeBundle: makeFunctionReference<"mutation", { jobId: string; expectedRevision: number }, null>("resumeBundles:remove"),
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
  getTargetProfile: makeFunctionReference<"query", Record<string, never>, TargetProfile | null>("targetProfile:get"),
  saveTargetProfile: makeFunctionReference<"mutation", { profile: TargetProfileInput }, number>("targetProfile:save"),
  requestDiscoveryScan: makeFunctionReference<"mutation", Record<string, never>, string>("autoDiscovery:requestScan"),
  listDiscoveryScanRuns: makeFunctionReference<"query", Record<string, never>, DiscoveryScanRun[]>("autoDiscovery:listRuns"),
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
