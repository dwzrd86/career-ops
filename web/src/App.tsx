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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type Turnstile = {
  remove(widgetId: string): void;
  render(container: HTMLElement, options: {
    action: string;
    callback(token: string): void;
    "error-callback"(): void;
    "expired-callback"(): void;
    sitekey: string;
    theme: "light";
  }): string;
  reset(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

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
  const [mode, setMode] = useState<"signIn" | "signUp" | "verify" | "reset" | "resetVerification">("signIn");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [botProtectionToken, setBotProtectionToken] = useState("");
  const botProtectionElement = useRef<HTMLDivElement>(null);
  const botProtectionWidgetId = useRef<string | undefined>(undefined);

  const isPasswordMode = mode === "signIn" || mode === "signUp";
  const isResetVerification = mode === "resetVerification";

  useEffect(() => {
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (mode !== "signUp" || !siteKey || !botProtectionElement.current) return;

    const render = () => {
      if (!window.turnstile || !botProtectionElement.current || botProtectionWidgetId.current) return;
      botProtectionWidgetId.current = window.turnstile.render(botProtectionElement.current, {
        action: "signup",
        callback: setBotProtectionToken,
        "error-callback": () => setBotProtectionToken(""),
        "expired-callback": () => setBotProtectionToken(""),
        sitekey: siteKey,
        theme: "light",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]');
    if (existing) {
      existing.addEventListener("load", render);
      render();
    } else {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.addEventListener("load", render);
      document.head.append(script);
    }

    return () => {
      if (botProtectionWidgetId.current && window.turnstile) window.turnstile.remove(botProtectionWidgetId.current);
      botProtectionWidgetId.current = undefined;
      setBotProtectionToken("");
    };
  }, [mode]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function passwordMeetsRequirements(password: string) {
    return password.length >= 12 && /[a-z]/i.test(password) && /\d/.test(password);
  }

  function startOver(nextMode: "signIn" | "signUp" | "reset") {
    setMode(nextMode);
    clearMessages();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submittedEmail = String(values.get("email") || email).trim();
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("confirmation") || "");
    const code = String(values.get("code") || "").trim();

    if ((mode === "signUp" || isResetVerification) && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    if ((mode === "signUp" || isResetVerification) && !passwordMeetsRequirements(password)) {
      setError("Use at least 12 characters, including a letter and a number.");
      return;
    }

    clearMessages();
    setIsSubmitting(true);
    try {
      if (mode === "reset") {
        // This response is intentionally identical for known and unknown addresses.
        await signIn("password", { email: submittedEmail, flow: "reset" });
        setEmail(submittedEmail);
        setMode("resetVerification");
        setNotice("If an account matches that address, a reset code is on its way.");
      } else if (mode === "verify") {
        await signIn("password", { email, code, flow: "email-verification" });
      } else if (isResetVerification) {
        await signIn("password", { email, code, newPassword: password, flow: "reset-verification" });
      } else {
        const result = await signIn("password", {
          ...(mode === "signUp" ? { botProtectionToken } : {}),
          email: submittedEmail,
          flow: mode,
          password,
        });
        if (!result.signingIn) {
          setEmail(submittedEmail);
          setMode("verify");
          setNotice("Check your inbox for an eight-digit verification code before accessing your pipeline.");
        }
      }
    } catch {
      if (mode === "reset") {
        setEmail(submittedEmail);
        setMode("resetVerification");
        setNotice("If an account matches that address, a reset code is on its way.");
      } else {
        setError(mode === "verify" || isResetVerification ? "We could not verify that code. Request a new one and try again." : "Authentication failed. Check your details and try again.");
      }
    } finally {
      // Turnstile tokens are single-use, so each server-side signup attempt needs a fresh one.
      if (mode === "signUp" && botProtectionWidgetId.current && window.turnstile) {
        window.turnstile.reset(botProtectionWidgetId.current);
        setBotProtectionToken("");
      }
      setIsSubmitting(false);
    }
  }

  async function resendVerification() {
    clearMessages();
    setIsSubmitting(true);
    try {
      await signIn("password", { email, flow: "email-verification" });
      setNotice("If the address is eligible for verification, a new code is on its way.");
    } catch {
      setNotice("If the address is eligible for verification, a new code is on its way.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const heading = mode === "signIn" ? "Welcome back." : mode === "signUp" ? "Create your secure workspace." : mode === "verify" ? "Verify your email." : mode === "reset" ? "Reset your password." : "Enter your reset code.";
  const submitLabel = mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create account" : mode === "verify" ? "Verify email" : mode === "reset" ? "Send reset code" : "Reset password";

  return (
    <main className="access-screen">
      <section className="access-panel">
        <div className="access-mark"><LockKeyhole size={22} /></div>
        <p className="eyebrow">Private career workspace</p>
        <h1>{heading}</h1>
        <p className="access-copy">
          {mode === "verify" ? `Enter the code sent to ${email}.` : "Job leads, applications, and tailored materials remain scoped to your authenticated account."}
        </p>
        <form onSubmit={submit}>
          {!isResetVerification && mode !== "verify" ? (
            <label>
              Email
              <input autoComplete="email" autoFocus name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            </label>
          ) : <input name="email" type="hidden" value={email} />}
          {isPasswordMode || isResetVerification ? (
            <label>
              {isResetVerification ? "New password" : "Password"}
              <input autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={12} name="password" required type="password" />
            </label>
          ) : null}
          {mode === "signUp" || isResetVerification ? (
            <label>
              Confirm password
              <input autoComplete="new-password" minLength={12} name="confirmation" required type="password" />
            </label>
          ) : null}
          {mode === "verify" || isResetVerification ? (
            <label>
              Code
              <input autoComplete="one-time-code" autoFocus inputMode="numeric" name="code" pattern="[0-9]{8}" required type="text" />
            </label>
          ) : null}
          {mode === "signUp" ? (
            <div aria-label="Bot protection" ref={botProtectionElement} />
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice ? <p className="access-notice" role="status">{notice}</p> : null}
          <button className="button primary access-submit" disabled={isSubmitting || (mode === "signUp" && !botProtectionToken)} type="submit">
            {isSubmitting ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}
            {submitLabel}
          </button>
        </form>
        {mode === "signUp" || isResetVerification ? <p className="access-hint">Use at least 12 characters, including a letter and a number.{mode === "signUp" && !import.meta.env.VITE_TURNSTILE_SITE_KEY ? " Registration is temporarily unavailable." : ""}</p> : null}
        {mode === "verify" ? <>
          <button className="text-button" disabled={isSubmitting} onClick={() => void resendVerification()} type="button">Resend verification code</button>
          <button className="text-button" onClick={() => startOver("signIn")} type="button">Back to sign in</button>
        </> : mode === "resetVerification" ? <button className="text-button" onClick={() => startOver("reset")} type="button">Request another reset code</button> : <>
          <button className="text-button" onClick={() => startOver(mode === "signIn" ? "signUp" : "signIn")} type="button">
            {mode === "signIn" ? "Create an account" : "Already have an account? Sign in"}
          </button>
          {mode === "signIn" ? <button className="text-button" onClick={() => startOver("reset")} type="button">Forgot your password?</button> : null}
        </>}
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
