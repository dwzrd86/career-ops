import type { PropsWithChildren } from "react";
import { useSyncExternalStore } from "react";
import {
  acknowledgeBrowserFlowPrivacy,
  browserFlowState,
  createBrowserFlowJob,
  subscribeBrowserFlow,
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

export function useQuery(reference: string) {
  const state = useBrowserFlowState();
  if (reference === "enrollment:status") return { enrolled: state.enrolled };
  if (reference === "privacy:status") {
    return {
      acknowledgedAt: state.privacyAcknowledged ? 1 : null,
      currentVersion: "isolated-browser-flow",
      requiresAcknowledgement: !state.privacyAcknowledged,
    };
  }
  if (reference === "jobs:list") return state.jobs;
  return undefined;
}

export function useMutation(reference: string) {
  return async (args: Record<string, string> = {}) => {
    if (reference === "privacy:acknowledge") return acknowledgeBrowserFlowPrivacy();
    if (reference === "jobs:create") return createBrowserFlowJob(args as Parameters<typeof createBrowserFlowJob>[0]);
    if (reference === "jobs:updateStatus") return updateBrowserFlowJobStatus(args.id, args.status as import("./mock-convex").JobStatus);
    if (reference === "jobs:remove") return undefined;
    if (reference === "errorReporting:reportClient") return undefined;
    throw new Error("unsupported browser-flow mutation");
  };
}
