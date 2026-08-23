import type { DiscoveredJob, DiscoveryDecisionOutcome, DiscoveryReviewStatus, Job, JobStatus } from "./mock-convex";

type BrowserFlowState = {
  authenticated: boolean;
  discoveredJobs: DiscoveredJob[];
  email: string | null;
  enrolled: boolean;
  jobs: Job[];
  password: string | null;
  pendingAccount: { email: string; password: string } | null;
  privacyAcknowledged: boolean;
};

const initialState = (): BrowserFlowState => ({
  authenticated: false,
  email: null,
  enrolled: true,
  discoveredJobs: [{
    _creationTime: 1,
    _id: "discovered-job-1",
    company: "Example Discovery Co.",
    decision: {
      decidedAt: 1,
      explanationCodes: ["ROLE_MATCH"],
      hardFilters: [
        { outcome: "pass", reasonCode: "LOCATION_ALLOWED", ruleId: "LOCATION" },
        { outcome: "fail", reasonCode: "WORK_AUTHORIZATION_REQUIRED", ruleId: "WORK_AUTHORIZATION" },
        { outcome: "unknown", reasonCode: "SALARY_UNKNOWN", ruleId: "SALARY" },
      ],
      outcome: "needsReview",
      profileVersion: 1,
      score: 84,
    },
    discoveredAt: 1,
    freshness: { checkedAt: Date.UTC(2026, 7, 22), status: "fresh" },
    localJobId: "browser-flow-discovery-1",
    materialStatus: {
      artifacts: { checklistReady: true, pdfReady: true, reportReady: true },
      createdAt: Date.UTC(2026, 7, 23),
      reviewState: "draftAwaitingReview",
      targetProfileVersion: 1,
    },
    location: "Remote",
    reviewStatus: "discovered",
    source: { label: "Mock Board", provider: "manual" },
    title: "Review target role",
    updatedAt: 1,
    url: "https://example.test/roles/review-target",
    effectiveOutcome: "needsReview",
    override: null,
  }],
  jobs: [],
  password: null,
  pendingAccount: null,
  privacyAcknowledged: false,
});

let state = initialState();
const listeners = new Set<() => void>();

function publish(next: Partial<BrowserFlowState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function browserFlowState() {
  return state;
}

export function subscribeBrowserFlow(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createBrowserFlowJob(input: Omit<Job, "_creationTime" | "_id" | "createdAt" | "status" | "updatedAt">) {
  const now = Date.now();
  const job: Job = {
    ...input,
    _creationTime: now,
    _id: `job-${now}`,
    createdAt: now,
    status: "discovered",
    updatedAt: now,
  };
  publish({ jobs: [job, ...state.jobs] });
  return job._id;
}

export function setBrowserFlowAuthentication(authenticated: boolean) {
  publish({ authenticated });
}

export function setBrowserFlowPendingAccount(email: string, password: string) {
  publish({ pendingAccount: { email, password } });
}

export function verifyBrowserFlowAccount() {
  if (state.pendingAccount === null) throw new Error("verification failed");
  publish({
    authenticated: true,
    email: state.pendingAccount.email,
    password: state.pendingAccount.password,
    pendingAccount: null,
  });
}

export function resetBrowserFlowPassword(password: string) {
  if (state.email === null) throw new Error("reset failed");
  publish({ password });
}

export function signInBrowserFlow(email: string, password: string) {
  if (state.email !== email || state.password !== password) throw new Error("sign-in failed");
  publish({ authenticated: true });
}

export function acknowledgeBrowserFlowPrivacy() {
  publish({ privacyAcknowledged: true });
}

export function updateBrowserFlowJobStatus(id: string, status: JobStatus) {
  publish({ jobs: state.jobs.map((job) => job._id === id ? { ...job, status, updatedAt: Date.now() } : job) });
}

export function updateBrowserFlowDiscoveryStatus(id: string, reviewStatus: DiscoveryReviewStatus) {
  publish({ discoveredJobs: state.discoveredJobs.map((job) => job._id === id ? { ...job, reviewStatus, updatedAt: Date.now() } : job) });
}

export function overrideBrowserFlowDiscoveryDecision(id: string, outcome: DiscoveryDecisionOutcome, reason: string) {
  publish({ discoveredJobs: state.discoveredJobs.map((job) => job._id === id ? {
    ...job,
    effectiveOutcome: outcome,
    override: { outcome, overriddenAt: Date.now(), reason },
    updatedAt: Date.now(),
  } : job) });
}
