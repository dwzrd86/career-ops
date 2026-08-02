import type { Job, JobStatus } from "./mock-convex";

type BrowserFlowState = {
  authenticated: boolean;
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

export function verifyBrowserFlowAccount(code: string) {
  if (code !== "12345678" || state.pendingAccount === null) throw new Error("verification failed");
  publish({
    authenticated: true,
    email: state.pendingAccount.email,
    password: state.pendingAccount.password,
    pendingAccount: null,
  });
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
