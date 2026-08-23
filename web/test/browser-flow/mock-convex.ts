export type JobStatus = "discovered" | "evaluated" | "applied" | "interview" | "offer" | "rejected" | "discarded";

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

export type DiscoveredJob = {
  _id: string;
  _creationTime: number;
  company: string;
  discoveredAt: number;
  freshness: { checkedAt: number; postedAt?: number; status: "fresh" | "stale" | "unknown" | "expired" };
  location?: string;
  localJobId: string;
  reviewStatus: DiscoveryReviewStatus;
  source: { label: string; provider: string };
  title: string;
  updatedAt: number;
  url: string;
  decision: {
    decidedAt: number;
    explanationCodes: string[];
    hardFilters: Array<{ outcome: "pass" | "fail" | "unknown" | "notApplicable"; reasonCode: string; ruleId: string }>;
    outcome: DiscoveryDecisionOutcome;
    profileVersion: number;
    score?: number;
  } | null;
  effectiveOutcome: DiscoveryDecisionOutcome | null;
  override: { outcome: DiscoveryDecisionOutcome; overriddenAt: number; reason: string } | null;
};

export const functions = {
  acknowledgePrivacy: "privacy:acknowledge",
  reportClientError: "errorReporting:reportClient",
  listJobs: "jobs:list",
  listDiscoveredJobs: "discovery:list",
  getPrivacyStatus: "privacy:status",
  getEnrollmentStatus: "enrollment:status",
  createJob: "jobs:create",
  updateJobStatus: "jobs:updateStatus",
  removeJob: "jobs:remove",
  shortlistDiscoveredJob: "discovery:shortlist",
  archiveDiscoveredJob: "discovery:archive",
  approveDiscoveredJobForEvaluation: "discovery:approveForEvaluation",
  overrideDiscoveredJobDecision: "discovery:overrideDecision",
};
