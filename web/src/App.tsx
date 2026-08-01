import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CirclePlus,
  ClipboardList,
  LockKeyhole,
  LoaderCircle,
  LogOut,
  MapPin,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { functions, Job, JobStatus } from "./convex";

const statusLabels: Record<JobStatus, string> = {
  discovered: "Discovered",
  evaluated: "Evaluated",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  discarded: "Discarded",
};

const activeStatuses: JobStatus[] = ["discovered", "evaluated", "applied", "interview", "offer"];

function StatusSelect({ job }: { job: Job }) {
  const updateStatus = useMutation(functions.updateJobStatus);

  return (
    <label className={`status-select status-${job.status}`}>
      <span className="sr-only">Update status for {job.title}</span>
      <select
        value={job.status}
        onChange={(event) => void updateStatus({ id: job._id, status: event.target.value as JobStatus })}
      >
        {Object.entries(statusLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" size={14} />
    </label>
  );
}

function NewJobDialog({ onClose }: { onClose: () => void }) {
  const createJob = useMutation(functions.createJob);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setIsSaving(true);
    setError("");

    try {
      await createJob({
        company: String(values.get("company") || "").trim(),
        title: String(values.get("title") || "").trim(),
        location: String(values.get("location") || "").trim() || "Not listed",
        url: String(values.get("url") || "").trim(),
        source: String(values.get("source") || "").trim() || "Manual entry",
        notes: String(values.get("notes") || "").trim() || undefined,
      });
      onClose();
    } catch {
      setError("The role could not be saved. Check the Convex connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-labelledby="new-job-title" className="dialog" role="dialog">
        <header>
          <div>
            <p className="eyebrow">Pipeline</p>
            <h2 id="new-job-title">Add a role</h2>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            Company
            <input autoFocus name="company" required />
          </label>
          <label>
            Role title
            <input name="title" required />
          </label>
          <div className="form-grid">
            <label>
              Location
              <input name="location" placeholder="Remote - USA" />
            </label>
            <label>
              Source
              <input name="source" placeholder="Company careers page" />
            </label>
          </div>
          <label>
            Application URL
            <input name="url" placeholder="https://..." required type="url" />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={3} />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <footer>
            <button className="button secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button primary" disabled={isSaving} type="submit">
              {isSaving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              Save role
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function EmptyPipeline({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><BriefcaseBusiness size={24} /></div>
      <h2>Your pipeline is clear.</h2>
      <p>Add a role manually or connect the existing Career-Ops scanner to this Convex dataset.</p>
      <button className="button primary" onClick={onAdd} type="button">
        <CirclePlus size={16} />
        Add a role
      </button>
    </section>
  );
}

function AccessScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") || "").trim();
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("confirmation") || "");

    if (mode === "signUp" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      await signIn("password", { email, password, flow: mode });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="access-screen">
      <section className="access-panel">
        <div className="access-mark"><LockKeyhole size={22} /></div>
        <p className="eyebrow">Private career workspace</p>
        <h1>{mode === "signIn" ? "Welcome back." : "Create your secure workspace."}</h1>
        <p className="access-copy">
          Job leads, applications, and tailored materials remain scoped to your authenticated account.
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input autoComplete="email" autoFocus name="email" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={12} name="password" required type="password" />
          </label>
          {mode === "signUp" ? (
            <label>
              Confirm password
              <input autoComplete="new-password" minLength={12} name="confirmation" required type="password" />
            </label>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button className="button primary access-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}
            {mode === "signIn" ? "Sign in" : "Create account"}
          </button>
        </form>
        {mode === "signUp" ? <p className="access-hint">Use at least 12 characters, including a letter and a number.</p> : null}
        <button className="text-button" onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(""); }} type="button">
          {mode === "signIn" ? "Create an account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}

function PipelineDashboard() {
  const jobs = useQuery(functions.listJobs, {});
  const [query, setQuery] = useState("");
  const [showNewJob, setShowNewJob] = useState(false);
  const { signOut } = useAuthActions();

  const filteredJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!jobs || !needle) return jobs || [];
    return jobs.filter((job) => `${job.company} ${job.title} ${job.location}`.toLowerCase().includes(needle));
  }, [jobs, query]);

  const activeCount = jobs?.filter((job) => activeStatuses.includes(job.status)).length ?? 0;
  const interviewCount = jobs?.filter((job) => job.status === "interview").length ?? 0;
  const appliedCount = jobs?.filter((job) => job.status === "applied").length ?? 0;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Sparkles size={20} /><span>Career Ops</span></div>
        <nav aria-label="Primary navigation">
          <a aria-current="page" href="#pipeline"><ClipboardList size={18} />Pipeline</a>
          <a href="#search"><Search size={18} />Discovery</a>
        </nav>
        <div className="sidebar-note">
          <span>Precision mode</span>
          <p>Only high-fit roles enter the active pipeline.</p>
        </div>
      </aside>

      <section className="workspace" id="pipeline">
        <header className="topbar">
          <div>
            <p className="eyebrow">Job search operations</p>
            <h1>Pipeline</h1>
          </div>
          <div className="topbar-actions">
            <button aria-label="Sign out" className="icon-button" onClick={() => void signOut()} title="Sign out" type="button"><LogOut size={17} /></button>
            <button className="button primary" onClick={() => setShowNewJob(true)} type="button">
              <CirclePlus size={16} />
              Add role
            </button>
          </div>
        </header>

        <section className="metric-grid" aria-label="Pipeline summary">
          <article><span>Active roles</span><strong>{activeCount}</strong></article>
          <article><span>Applications</span><strong>{appliedCount}</strong></article>
          <article><span>Interviews</span><strong>{interviewCount}</strong></article>
        </section>

        <section className="pipeline-panel">
          <header className="panel-header">
            <div>
              <h2>Role queue</h2>
              <p>Track the next decision, not just the next application.</p>
            </div>
            <label className="search-field">
              <Search size={16} />
              <span className="sr-only">Search roles</span>
              <input onChange={(event) => setQuery(event.target.value)} placeholder="Search roles" value={query} />
            </label>
          </header>

          {jobs === undefined ? (
            <div className="loading-state"><LoaderCircle className="spin" size={20} />Loading pipeline</div>
          ) : filteredJobs.length === 0 ? (
            <EmptyPipeline onAdd={() => setShowNewJob(true)} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Role</th><th>Location</th><th>Source</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job._id}>
                      <td><strong>{job.title}</strong><span>{job.company}</span></td>
                      <td><span className="location"><MapPin size={14} />{job.location}</span></td>
                      <td>{job.source}</td>
                      <td><StatusSelect job={job} /></td>
                      <td><a aria-label={`Open ${job.title} at ${job.company}`} className="icon-button" href={job.url} rel="noreferrer" target="_blank"><ArrowUpRight size={17} /></a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      {showNewJob ? <NewJobDialog onClose={() => setShowNewJob(false)} /> : null}
    </main>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading><main className="loading-state full-screen"><LoaderCircle className="spin" size={22} />Securing your workspace</main></AuthLoading>
      <Unauthenticated><AccessScreen /></Unauthenticated>
      <Authenticated><PipelineDashboard /></Authenticated>
    </>
  );
}
