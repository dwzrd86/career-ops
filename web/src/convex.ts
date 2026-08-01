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

export const functions = {
  listJobs: makeFunctionReference<"query", Record<string, never>, Job[]>("jobs:list"),
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
};
