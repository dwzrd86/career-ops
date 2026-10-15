import type { PropsWithChildren } from "react";
import { useSyncExternalStore } from "react";
import {
  acknowledgeBrowserFlowPrivacy,
  browserFlowState,
  createBrowserFlowJob,
  overrideBrowserFlowDiscoveryDecision,
  requestBrowserFlowScan,
  saveBrowserFlowTargetProfile,
  saveBrowserFlowBundle,
  removeBrowserFlowBundle,
  subscribeBrowserFlow,
  updateBrowserFlowDiscoveryStatus,
  updateBrowserFlowJobStatus,
} from "./browser-state";

function useBrowserFlowState() {
  return useSyncExternalStore(subscribeBrowserFlow, browserFlowState, browserFlowState);
}

export function AuthLoading(_props: PropsWithChildren) {
  return null;
}

export function Authenticated({ children }: PropsWithChildren) {
  return useBrowserFlowState().authenticated ? children : null;
}

export function Unauthenticated({ children }: PropsWithChildren) {
  return useBrowserFlowState().authenticated ? null : children;
}

export function useQuery(reference: string, args?: Record<string, any> | "skip") {
  const state = useBrowserFlowState();
  if (reference === "enrollment:status") return { enrolled: state.enrolled };
  if (reference === "privacy:status") {
    return {
      acknowledgedAt: state.privacyAcknowledged ? 1 : null,
      currentVersion: "isolated-browser-flow",
      requiresAcknowledgement: !state.privacyAcknowledged,
    };
  }
  if (reference === "resumeBundles:sources") {
    const seen = new Set<string>();
    return Object.values(state.resumeBundles).sort((a, b) => b.updatedAt - a.updatedAt).flatMap(bundle => {
      const job = state.jobs.find(item => item._id === bundle.jobId);
      if (!job || seen.has(bundle.sourceResume)) return [];
      seen.add(bundle.sourceResume);
      return [{ jobId: job._id, company: job.company, title: job.title, sourceResume: bundle.sourceResume, updatedAt: bundle.updatedAt }];
    });
  }
  if (reference === "resumeBundles:get") return args && args !== "skip" ? state.resumeBundles[args.jobId] ?? null : undefined;
  if (reference === "jobs:list") return state.jobs;
  if (reference === "discovery:list") return state.discoveredJobs;
  if (reference === "targetProfile:get") return state.targetProfile;
  if (reference === "autoDiscovery:listRuns") return state.scanRuns;
  return undefined;
}

export function useMutation(reference: string) {
  return async (args: Record<string, any> = {}) => {
    if (reference === "resumeBundles:save") return saveBrowserFlowBundle(args);
    if (reference === "resumeBundles:remove") return removeBrowserFlowBundle(args.jobId);
    if (reference === "privacy:acknowledge") return acknowledgeBrowserFlowPrivacy();
    if (reference === "jobs:create") return createBrowserFlowJob(args as Parameters<typeof createBrowserFlowJob>[0]);
    if (reference === "jobs:updateStatus") return updateBrowserFlowJobStatus(args.id, args.status as import("./mock-convex").JobStatus);
    if (reference === "jobs:remove") return undefined;
    if (reference === "discovery:shortlist") return updateBrowserFlowDiscoveryStatus(args.id, "shortlisted");
    if (reference === "discovery:archive") return updateBrowserFlowDiscoveryStatus(args.id, "archived");
    if (reference === "discovery:approveForEvaluation") return updateBrowserFlowDiscoveryStatus(args.id, "approvedForEvaluation");
    if (reference === "discovery:overrideDecision") return overrideBrowserFlowDiscoveryDecision(args.id, args.outcome as import("./mock-convex").DiscoveryDecisionOutcome, args.reason);
    if (reference === "targetProfile:save") return saveBrowserFlowTargetProfile(args.profile);
    if (reference === "autoDiscovery:requestScan") return requestBrowserFlowScan();
    if (reference === "errorReporting:reportClient") return undefined;
    throw new Error("unsupported browser-flow mutation");
  };
}
