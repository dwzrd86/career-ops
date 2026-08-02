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

export const functions = {
  acknowledgePrivacy: "privacy:acknowledge",
  reportClientError: "errorReporting:reportClient",
  listJobs: "jobs:list",
  getPrivacyStatus: "privacy:status",
  getEnrollmentStatus: "enrollment:status",
  createJob: "jobs:create",
  updateJobStatus: "jobs:updateStatus",
  removeJob: "jobs:remove",
};
