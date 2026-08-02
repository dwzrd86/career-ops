import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const errorCategories = [
  "authenticationFailed",
  "operationFailed",
  "unexpected",
  "validationFailed",
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

type DiagnosticEvent = {
  deploymentVersion?: string;
  errorCategory: ErrorCategory;
  operationType: string;
  route: string;
};

const safeLabel = /^[a-z0-9._-]{1,80}$/i;

function safeDeploymentVersion(value: string | undefined) {
  return value && safeLabel.test(value) ? value : "unversioned";
}

function safeOperationType(value: string) {
  return safeLabel.test(value) ? value : "unknown";
}

/** Keep only a same-origin path; diagnostics must never retain query data. */
export function safeRoute(value: string) {
  try {
    const url = new URL(value, "https://diagnostic.invalid");
    return url.pathname.startsWith("/") ? url.pathname.slice(0, 160) || "/" : "/";
  } catch {
    return "/";
  }
}

/**
 * Construct the entire persisted diagnostic record. Error objects, messages,
 * stack traces, request payloads, users, and URLs with queries are intentionally
 * absent from this type so callers cannot accidentally persist them.
 */
export function diagnosticEvent(event: DiagnosticEvent) {
  return {
    deploymentVersion: safeDeploymentVersion(event.deploymentVersion),
    errorCategory: event.errorCategory,
    operationType: safeOperationType(event.operationType),
    route: safeRoute(event.route),
  };
}

const errorCategoryValidator = v.union(
  v.literal("authenticationFailed"),
  v.literal("operationFailed"),
  v.literal("unexpected"),
  v.literal("validationFailed"),
);

/** Browser reporting endpoint. It accepts metadata only and is never queried by clients. */
export const reportClient = mutationGeneric({
  args: {
    deploymentVersion: v.string(),
    errorCategory: errorCategoryValidator,
    operationType: v.string(),
    route: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("errorReports", { ...diagnosticEvent(args), occurredAt: Date.now() });
  },
});

/**
 * Write structured server diagnostics before rethrowing. Convex rolls back a
 * failed mutation's database writes, so a runtime log is the durable backend
 * sink for failures. Never pass the error object itself.
 */
export function reportBackendError(
  operationType: string,
  errorCategory: ErrorCategory = "operationFailed",
) {
  console.error("jobbie-error", JSON.stringify({
    ...diagnosticEvent({
      deploymentVersion: process.env.APP_DEPLOYMENT_VERSION,
      errorCategory,
      operationType,
      route: "/convex",
    }),
    occurredAt: Date.now(),
  }));
}
