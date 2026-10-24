import type { DiscoveredJob, DiscoveryDecisionOutcome, DiscoveryReviewStatus, Job, JobStatus } from "./mock-convex";
import type { DiscoveryScanRun, TargetProfile, TargetProfileInput, ResumeBundle } from "../../src/convex";

type BrowserFlowState = {
  hostedAvailability: { remaining: number; pending: boolean; reason: "ready" | "unavailable" | "quota" | "budget" };
  hostedRequest: { requestId: string; jobId: string; bundleRevision: number; status: "pending" | "succeeded" | "failed"; failureCode?: string } | null;
  authenticated: boolean;
  discoveredJobs: DiscoveredJob[];
  email: string | null;
  enrolled: boolean;
  jobs: Job[];
  password: string | null;
  pendingAccount: { email: string; password: string } | null;
  privacyAcknowledged: boolean;
  targetProfile: TargetProfile | null;
  scanRuns: DiscoveryScanRun[];
  resumeBundles: Record<string, ResumeBundle>;
};

const initialState = (): BrowserFlowState => ({
  hostedAvailability: { remaining: 20, pending: false, reason: "ready" },
  hostedRequest: null,
  authenticated: false,
  email: null,
  enrolled: true,
  discoveredJobs: [{
    _creationTime: 1,
    _id: "discovered-job-1",
    company: "Example Discovery Co.",
    postingText: "SQL and AWS required.\nBuild reliable reporting.",
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
  targetProfile: null,
  scanRuns: [],
  resumeBundles: {},
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

export function saveBrowserFlowTargetProfile(profile: TargetProfileInput) {
  const version = (state.targetProfile?.profileVersion ?? 0) + 1;
  publish({ targetProfile: { ...profile, profileVersion: version, updatedAt: Date.now() } });
  return version;
}

export function requestBrowserFlowScan() {
  if (!state.targetProfile?.enabled) throw new Error("Save and enable your Target Profile before scanning");
  const now = Date.now();
  publish({ scanRuns: [{ _id: `run-${now}`, profileVersion: state.targetProfile.profileVersion, trigger: "manual", status: "succeeded", queuedAt: now, finishedAt: now, feedsSucceeded: 2, feedsFailed: 0, discovered: 1, reviewable: 1, rejected: 0 }, ...state.scanRuns] });
  return `run-${now}`;
}

export function updateBrowserFlowJobStatus(id: string, status: JobStatus) {
  publish({ jobs: state.jobs.map((job) => job._id === id ? { ...job, status, updatedAt: Date.now() } : job) });
}

export function updateBrowserFlowDiscoveryStatus(id: string, reviewStatus: DiscoveryReviewStatus) {
  if (reviewStatus === "approvedForEvaluation") {
    const discovered = state.discoveredJobs.find(job => job._id === id);
    if (!discovered) throw new Error("Discovered job not found");
    if (!state.jobs.some(job => job.url === discovered.url)) {
      createBrowserFlowJob({ company: discovered.company, title: discovered.title,
        location: discovered.location || "Not specified", url: discovered.url, source: discovered.source.label, postingText: discovered.postingText });
    }
  }
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

export function saveBrowserFlowBundle(args: any) {
  const revision = (state.resumeBundles[args.jobId]?.revision ?? 0) + 1;
  publish({ resumeBundles: { ...state.resumeBundles, [args.jobId]: {
    jobId: args.jobId, sourceResume: args.sourceResume, description: args.description,
    resume: args.resume, revision, reviewedAt: args.reviewed ? Date.now() : null, updatedAt: Date.now(),
  } } });
  return revision;
}

export function removeBrowserFlowBundle(jobId: string) {
  const next = { ...state.resumeBundles };
  delete next[jobId];
  publish({ resumeBundles: next });
  return null;
}

export function requestBrowserFlowHostedResume(args: any) {
  const bundle = state.resumeBundles[args.jobId];
  if (!args.consent.shareSelectedEvidence || args.expectedRevision !== bundle?.revision) throw new Error("stale or missing consent");
  const requestId = `request-${Date.now()}`;
  publish({ hostedRequest: { requestId, jobId: args.jobId, bundleRevision: bundle.revision, status: "pending" },
    hostedAvailability: { remaining: state.hostedAvailability.remaining - 1, pending: true, reason: "ready" } });
  return requestId;
}
// Test-only controls exercise real Studio rendering; they never invoke a provider.
Object.assign(window, {
  __completeHosted(failureCode?: string, conflict = false) {
    const request = state.hostedRequest!;
    const bundle = state.resumeBundles[request.jobId];
    if (!failureCode) saveBrowserFlowBundle({ ...bundle, resume: "Test Candidate\nEXPERIENCE\nBuilt Python automation with SQL on AWS.\nSKILLS\nPython, SQL, AWS", reviewed: false });
    if (conflict) saveBrowserFlowBundle({ ...state.resumeBundles[request.jobId], resume: "Another tab draft", reviewed: false });
    publish({ hostedRequest: { ...request, status: failureCode ? "failed" : "succeeded", failureCode },
      hostedAvailability: { ...state.hostedAvailability, pending: false } });
  },
  __hostedAvailability(reason: BrowserFlowState["hostedAvailability"]["reason"]) {
    publish({ hostedAvailability: { ...state.hostedAvailability, reason, remaining: reason === "quota" ? 0 : 19 } });
  },
});
