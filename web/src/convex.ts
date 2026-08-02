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

export type PrivacyStatus = {
  acknowledgedAt: number | null;
  currentVersion: string;
  requiresAcknowledgement: boolean;
};

export type EnrollmentStatus = {
  enrolled: boolean;
};

export const functions = {
  acknowledgePrivacy: makeFunctionReference<"mutation", Record<string, never>, null>("privacy:acknowledge"),
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
};
