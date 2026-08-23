import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
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
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DiscoveredJob, DiscoveryDecisionOutcome, functions, Job, JobStatus } from "./convex";
import { authClient } from "./auth-client";
import { useSafeErrorReporter, useUnhandledErrorReporting } from "./errorReporting";

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

const policyLinks = {
  privacy: "https://github.com/dwzrd86/career-ops/blob/main/docs/PRIVACY.md",
  security: "https://github.com/dwzrd86/career-ops/blob/main/docs/SECURITY_CONTACT.md",
  terms: "https://github.com/dwzrd86/career-ops/blob/main/docs/TERMS.md",
};

function passwordMeetsRequirements(password: string) {
  return password.length >= 12 && /[a-z]/i.test(password) && /\d/.test(password);
}

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
  const reportError = useSafeErrorReporter();

  async function update(event: ChangeEvent<HTMLSelectElement>) {
    try {
      await updateStatus({ id: job._id, status: event.target.value as JobStatus });
    } catch {
      reportError("job.status.update", "operationFailed");
    }
  }

  return (
    <label className={`status-select status-${job.status}`}>
      <span className="sr-only">Update status for {job.title}</span>
      <select
        value={job.status}
        onChange={(event) => void update(event)}
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

function JobActions({ job }: { job: Job }) {
  const removeJob = useMutation(functions.removeJob);
  const reportError = useSafeErrorReporter();

  async function remove() {
    if (!window.confirm(`Remove ${job.title} at ${job.company} from your pipeline?`)) return;
    try {
      await removeJob({ id: job._id });
    } catch {
      reportError("job.remove", "operationFailed");
    }
  }

  return (
    <>
      <a aria-label={`Open ${job.title} at ${job.company}`} className="icon-button" href={job.url} rel="noreferrer" target="_blank"><ArrowUpRight size={17} /></a>
      <button aria-label={`Remove ${job.title} at ${job.company}`} className="icon-button" onClick={() => void remove()} title="Remove role" type="button"><Trash2 size={17} /></button>
    </>
  );
}

function NewJobDialog({ onClose }: { onClose: () => void }) {
  const createJob = useMutation(functions.createJob);
  const reportError = useSafeErrorReporter();
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
      reportError("job.create", "operationFailed");
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

function humanizeCode(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function discoveryNextAction(job: DiscoveredJob) {
  if (job.reviewStatus === "archived") return "Archived — no further action";
  if (job.reviewStatus === "approvedForEvaluation") return "Ready for evaluation";
  if (job.reviewStatus === "shortlisted") return "Shortlisted for evaluation review";
  if (job.effectiveOutcome === "rejected") return "Archive or override this decision";
  if (job.effectiveOutcome === "needsReview") return "Review unknowns and hard filters";
  return "Shortlist or approve for evaluation";
}

function freshnessLabel(job: DiscoveredJob) {
  const checked = new Date(job.freshness.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${humanizeCode(job.freshness.status)} · checked ${checked}`;
}

function OverrideDecisionDialog({ job, onClose }: { job: DiscoveredJob; onClose: () => void }) {
  const overrideDecision = useMutation(functions.overrideDiscoveredJobDecision);
  const reportError = useSafeErrorReporter();
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError("");
    setIsSaving(true);
    try {
      await overrideDecision({
        id: job._id,
        outcome: String(values.get("outcome")) as DiscoveryDecisionOutcome,
        reason: String(values.get("reason") || "").trim(),
      });
      onClose();
    } catch {
      reportError("discovery.override-decision", "operationFailed");
      setError("The override could not be saved. Check the connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-labelledby="override-decision-title" className="dialog" role="dialog">
        <header>
          <div>
            <p className="eyebrow">Discovery review</p>
            <h2 id="override-decision-title">Override discovery decision</h2>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <p className="dialog-copy">Record why {job.title} at {job.company} needs a different match decision.</p>
        <form onSubmit={submit}>
          <label>
            New decision
            <select defaultValue={job.effectiveOutcome ?? "needsReview"} name="outcome">
              <option value="ranked">Ranked</option>
              <option value="needsReview">Needs review</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            Override reason
            <textarea autoFocus name="reason" required rows={4} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer>
            <button className="button secondary" onClick={onClose} type="button">Cancel</button>
            <button className="button primary" disabled={isSaving} type="submit">{isSaving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save override</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DiscoveryActions({ job, onOverride }: { job: DiscoveredJob; onOverride: () => void }) {
  const shortlist = useMutation(functions.shortlistDiscoveredJob);
  const archive = useMutation(functions.archiveDiscoveredJob);
  const approveForEvaluation = useMutation(functions.approveDiscoveredJobForEvaluation);
  const reportError = useSafeErrorReporter();
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function run(action: "shortlist" | "archive" | "approve") {
    setError("");
    setPendingAction(action);
    try {
      if (action === "shortlist") await shortlist({ id: job._id });
      if (action === "archive") await archive({ id: job._id });
      if (action === "approve") await approveForEvaluation({ id: job._id });
    } catch {
      reportError(`discovery.${action}`, "operationFailed");
      setError("The review action could not be saved. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="discovery-actions">
      <button className="button secondary" disabled={pendingAction !== null} onClick={() => void run("shortlist")} type="button">Shortlist</button>
      <button className="button secondary" disabled={pendingAction !== null} onClick={() => void run("archive")} type="button">Archive</button>
      <button className="button secondary" disabled={pendingAction !== null} onClick={onOverride} type="button">Override decision</button>
      <button className="button primary" disabled={pendingAction !== null} onClick={() => void run("approve")} type="button">Approve for evaluation</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function DiscoveryReviewQueue() {
  const discoveredJobs = useQuery(functions.listDiscoveredJobs, {});
  const [overrideJob, setOverrideJob] = useState<DiscoveredJob | null>(null);

  return (
    <section className="discovery-panel" id="review-queue" aria-labelledby="review-queue-title">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Private review</p>
          <h2 id="review-queue-title">Discovery review queue</h2>
          <p>Review projected job metadata before it enters evaluation.</p>
        </div>
      </header>
      {discoveredJobs === undefined ? <div className="loading-state"><LoaderCircle className="spin" size={20} />Loading discovery queue</div> : discoveredJobs.length === 0 ? (
        <div className="discovery-empty"><strong>No discovered roles to review.</strong><span>New projected matches will appear here for your decision.</span></div>
      ) : (
        <div className="discovery-list">
          {discoveredJobs.map((job) => {
            const hardFilterReasons = job.decision?.hardFilters.filter((filter) => filter.outcome === "fail") ?? [];
            const unknowns = job.decision?.hardFilters.filter((filter) => filter.outcome === "unknown") ?? [];
            return (
              <article className="discovery-card" key={job._id}>
                <div className="discovery-card-heading">
                  <div>
                    <h3>{job.title}</h3>
                    <p>{job.company}{job.location ? ` · ${job.location}` : ""}</p>
                  </div>
                  <span className={`review-status review-status-${job.reviewStatus}`}>{humanizeCode(job.reviewStatus)}</span>
                </div>
                <dl className="discovery-details">
                  <div><dt>Source</dt><dd>{job.source.label}</dd></div>
                  <div><dt>Freshness</dt><dd>{freshnessLabel(job)}</dd></div>
                  <div><dt>Score</dt><dd>{job.decision?.score ?? "Not scored"}</dd></div>
                  <div><dt>Decision</dt><dd>{humanizeCode(job.effectiveOutcome ?? job.decision?.outcome ?? "needsReview")}</dd></div>
                </dl>
                <div className="discovery-signals">
                  <div><span>Hard-filter reasons</span>{hardFilterReasons.length ? <ul>{hardFilterReasons.map((filter) => <li key={`${filter.ruleId}-${filter.reasonCode}`}>{humanizeCode(filter.reasonCode)}</li>)}</ul> : <p>None recorded</p>}</div>
                  <div><span>Unknowns</span>{unknowns.length ? <ul>{unknowns.map((filter) => <li key={`${filter.ruleId}-${filter.reasonCode}`}>{humanizeCode(filter.reasonCode)}</li>)}</ul> : <p>None recorded</p>}</div>
                  <div><span>Next action</span><p>{discoveryNextAction(job)}</p></div>
                </div>
                <DiscoveryActions job={job} onOverride={() => setOverrideJob(job)} />
              </article>
            );
          })}
        </div>
      )}
      {overrideJob ? <OverrideDecisionDialog job={overrideJob} onClose={() => setOverrideJob(null)} /> : null}
    </section>
  );
}

function AccessScreen({ initialMode }: { initialMode: "signIn" | "reset" }) {
  const reportError = useSafeErrorReporter();
  const resetToken = new URLSearchParams(window.location.search).get("token");
  const [mode, setMode] = useState<"signIn" | "signUp" | "verify" | "reset" | "resetVerification">(
    resetToken ? "resetVerification" : initialMode,
  );
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
    const inviteToken = String(values.get("inviteToken") || "").trim();

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
        const result = await authClient.requestPasswordReset({ email: submittedEmail, redirectTo: window.location.origin });
        if (result.error) throw new Error(result.error.message);
        setEmail(submittedEmail);
        setNotice("If an account matches that address, a reset link is on its way.");
      } else if (mode === "verify") {
        const result = await authClient.sendVerificationEmail({ email, callbackURL: window.location.origin });
        if (result.error) throw new Error(result.error.message);
        setNotice("If the address is eligible for verification, a new link is on its way.");
      } else if (isResetVerification) {
        if (!resetToken) throw new Error("Missing reset token");
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken });
        if (result.error) throw new Error(result.error.message);
        window.history.replaceState({}, "", window.location.pathname);
        setMode("signIn");
        setNotice("Password reset. Sign in with your new password.");
      } else if (mode === "signUp") {
        const result = await authClient.signUp.email({
          botProtectionToken,
          callbackURL: window.location.origin,
          email: submittedEmail,
          inviteToken,
          name: submittedEmail.split("@")[0] || "Jobbie user",
          password,
        } as Parameters<typeof authClient.signUp.email>[0]);
        if (result.error) throw new Error(result.error.message);
        setEmail(submittedEmail);
        setMode("verify");
        setNotice("Check your inbox for a verification link before accessing your pipeline.");
      } else {
        const result = await authClient.signIn.email({ email: submittedEmail, password, rememberMe: true });
        if (result.error) throw new Error(result.error.message);
      }
    } catch {
      reportError("auth.submit", "authenticationFailed");
      if (mode === "reset") {
        setEmail(submittedEmail);
        setNotice("If an account matches that address, a reset link is on its way.");
      } else {
        setError(mode === "verify" || isResetVerification ? "We could not complete that request. Request a new link and try again." : "Authentication failed. Check your details and try again.");
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
      const result = await authClient.sendVerificationEmail({ email, callbackURL: window.location.origin });
      if (result.error) throw new Error(result.error.message);
      setNotice("If the address is eligible for verification, a new link is on its way.");
    } catch {
      reportError("auth.resend-verification", "authenticationFailed");
      setNotice("If the address is eligible for verification, a new link is on its way.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const heading = mode === "signIn" ? "Welcome back." : mode === "signUp" ? "Create your secure workspace." : mode === "verify" ? "Verify your email." : mode === "reset" ? "Reset your password." : "Choose a new password.";
  const submitLabel = mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create account" : mode === "verify" ? "Resend verification link" : mode === "reset" ? "Send reset link" : "Reset password";

  return (
    <main className="access-screen">
      <section className="access-panel">
        <div className="access-mark"><LockKeyhole size={22} /></div>
        <p className="eyebrow">Private career workspace</p>
        <h1>{heading}</h1>
        <p className="access-copy">
          {mode === "verify" ? `Open the verification link sent to ${email}.` : "Job leads, applications, and tailored materials remain scoped to your authenticated account."}
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
          {mode === "signUp" ? (
            <label>
              Alpha invite code
              <input autoComplete="off" name="inviteToken" required />
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
        {mode === "signUp" || isResetVerification ? <p className="access-hint">Use at least 12 characters, including a letter and a number.{mode === "signUp" ? " A valid alpha invite code is also required." : ""}{mode === "signUp" && !import.meta.env.VITE_TURNSTILE_SITE_KEY ? " Registration is temporarily unavailable." : ""}</p> : null}
        {mode === "verify" ? <>
          <button className="text-button" disabled={isSubmitting} onClick={() => void resendVerification()} type="button">Resend verification link</button>
          <button className="text-button" onClick={() => startOver("signIn")} type="button">Back to sign in</button>
        </> : mode === "resetVerification" ? <button className="text-button" onClick={() => startOver("reset")} type="button">Request another reset link</button> : <>
          <button className="text-button" onClick={() => startOver(mode === "signIn" ? "signUp" : "signIn")} type="button">
            {mode === "signIn" ? "Create an account" : "Already have an account? Sign in"}
          </button>
          {mode === "signIn" ? <button className="text-button" onClick={() => startOver("reset")} type="button">Forgot your password?</button> : null}
        </>}
      </section>
    </main>
  );
}

function EnrollmentGate({
  onRecovery,
  onSignOut,
}: {
  onRecovery: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const enrollmentStatus = useQuery(functions.getEnrollmentStatus, {});

  if (enrollmentStatus === undefined) {
    return <main className="loading-state full-screen"><LoaderCircle className="spin" size={22} />Checking alpha enrollment</main>;
  }
  if (enrollmentStatus.enrolled) {
    return <PrivacyAcknowledgement onRecovery={onRecovery} onSignOut={onSignOut} />;
  }

  return (
    <main className="access-screen">
      <section aria-labelledby="enrollment-title" className="access-panel privacy-panel">
        <div className="access-mark"><LockKeyhole size={22} /></div>
        <p className="eyebrow">Closed alpha</p>
        <h1 id="enrollment-title">This account is not enrolled.</h1>
        <p className="access-copy">This workspace is available only through a single-use alpha invite. Contact the person who invited you if you need access.</p>
        <button className="button primary access-submit" onClick={() => void onSignOut()} type="button"><LogOut size={16} />Sign out</button>
      </section>
    </main>
  );
}

function PrivacyAcknowledgement({
  onRecovery,
  onSignOut,
}: {
  onRecovery: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const privacyStatus = useQuery(functions.getPrivacyStatus, {});
  const acknowledgePrivacy = useMutation(functions.acknowledgePrivacy);
  const reportError = useSafeErrorReporter();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (privacyStatus === undefined) {
    return <main className="loading-state full-screen"><LoaderCircle className="spin" size={22} />Loading privacy notice</main>;
  }

  if (!privacyStatus.requiresAcknowledgement) {
    return <PipelineDashboard onRecovery={onRecovery} onSignOut={onSignOut} />;
  }

  async function acknowledge() {
    setError("");
    setIsSaving(true);
    try {
      await acknowledgePrivacy({});
    } catch {
      reportError("privacy.acknowledge", "operationFailed");
      setError("We could not save your acknowledgement. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="access-screen">
      <section aria-labelledby="privacy-notice-title" className="access-panel privacy-panel">
        <div className="access-mark"><ShieldCheck size={22} /></div>
        <p className="eyebrow">Before you add career data</p>
        <h1 id="privacy-notice-title">Review the alpha privacy notice.</h1>
        <p className="access-copy">Jobbie stores the roles, job links, and notes you add to your private pipeline. Please read the current policies before saving that information.</p>
        <ul className="policy-links">
          <li><a href={policyLinks.privacy} rel="noreferrer" target="_blank">Privacy notice (version {privacyStatus.currentVersion})</a></li>
          <li><a href={policyLinks.terms} rel="noreferrer" target="_blank">Alpha terms of use</a></li>
          <li><a href={policyLinks.security} rel="noreferrer" target="_blank">Security contact</a></li>
        </ul>
        <label className="acknowledgement-check">
          <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          <span>I have reviewed the privacy notice and understand this alpha stores the career data I choose to add.</span>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button primary access-submit" disabled={!confirmed || isSaving} onClick={() => void acknowledge()} type="button">
          {isSaving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
          Acknowledge and continue
        </button>
        <button className="text-button" disabled={isSaving} onClick={() => void onSignOut()} type="button">Sign out instead</button>
      </section>
    </main>
  );
}

function AccountSecurityDialog({
  onClose,
  onRecovery,
  onSignOut,
}: {
  onClose: () => void;
  onRecovery: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const reportError = useSafeErrorReporter();
  const accountExport = useQuery(functions.exportAccountData, {});
  const recordExport = useMutation(functions.recordAccountExport);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function downloadExport() {
    if (accountExport === undefined) return;
    await recordExport({});
    const blob = new Blob([JSON.stringify(accountExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "jobbie-account-export.json";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    const password = window.prompt("Enter your current password to permanently delete your account and pipeline.");
    if (!password || !window.confirm("Permanently delete your account and all pipeline data? This cannot be undone.")) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.deleteUser({ password });
      if (result.error) throw new Error(result.error.message);
    } catch {
      setError("We could not delete your account. Check your password and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const currentPassword = String(values.get("currentPassword") || "");
    const newPassword = String(values.get("newPassword") || "");
    const confirmation = String(values.get("confirmation") || "");

    if (newPassword !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    if (!passwordMeetsRequirements(newPassword)) {
      setError("Use at least 12 characters, including a letter and a number.");
      return;
    }

    setError("");
    setNotice("");
    setIsSubmitting(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.message);
      setNotice("Password updated. Other active sessions have been signed out.");
      event.currentTarget.reset();
    } catch {
      reportError("auth.change-password", "authenticationFailed");
      setError("We could not change your password. Check your current password and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-labelledby="account-security-title" className="dialog account-security-dialog" role="dialog">
        <header>
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="account-security-title">Account security and data</h2>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <p className="dialog-copy">Change your password, end this browser session, or recover access with a verified email code.</p>
        <form onSubmit={submit}>
          <label>
            Current password
            <input autoComplete="current-password" autoFocus name="currentPassword" required type="password" />
          </label>
          <label>
            New password
            <input autoComplete="new-password" minLength={12} name="newPassword" required type="password" />
          </label>
          <label>
            Confirm new password
            <input autoComplete="new-password" minLength={12} name="confirmation" required type="password" />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice ? <p className="access-notice" role="status">{notice}</p> : null}
          <footer>
            <button className="button secondary" onClick={onClose} type="button">Close</button>
            <button className="button primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
              Change password
            </button>
          </footer>
        </form>
        <div className="account-security-actions">
          <button className="text-button" disabled={isSubmitting} onClick={() => void onSignOut()} type="button">Sign out from this session</button>
          <button className="text-button" disabled={isSubmitting} onClick={() => void onRecovery()} type="button">Use email recovery instead</button>
        </div>
        <section aria-label="Account data controls" className="account-data-controls">
          <h3>Account data</h3>
          <p>Download your pipeline data or permanently delete this account and its pipeline.</p>
          <div>
            <button className="button secondary" disabled={accountExport === undefined || isSubmitting} onClick={() => void downloadExport()} type="button">Download data export</button>
            <button className="button secondary" disabled={isSubmitting} onClick={() => void deleteAccount()} type="button">Delete account</button>
          </div>
          <p className="account-policy-links"><a href={policyLinks.privacy} rel="noreferrer" target="_blank">Privacy notice</a><span aria-hidden="true">·</span><a href={policyLinks.terms} rel="noreferrer" target="_blank">Terms</a><span aria-hidden="true">·</span><a href={policyLinks.security} rel="noreferrer" target="_blank">Security contact</a></p>
        </section>
      </section>
    </div>
  );
}

function PipelineDashboard({
  onRecovery,
  onSignOut,
}: {
  onRecovery: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const jobs = useQuery(functions.listJobs, {});
  const [query, setQuery] = useState("");
  const [showNewJob, setShowNewJob] = useState(false);
  const [showAccountSecurity, setShowAccountSecurity] = useState(false);

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
          <a href="#review-queue"><Search size={18} />Discovery review</a>
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
            <button aria-label="Account security" className="icon-button" onClick={() => setShowAccountSecurity(true)} title="Account security" type="button"><ShieldCheck size={17} /></button>
            <button aria-label="Sign out" className="icon-button" onClick={() => void onSignOut()} title="Sign out" type="button"><LogOut size={17} /></button>
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
                      <td><JobActions job={job} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <DiscoveryReviewQueue />
      </section>

      {showNewJob ? <NewJobDialog onClose={() => setShowNewJob(false)} /> : null}
      {showAccountSecurity ? <AccountSecurityDialog onClose={() => setShowAccountSecurity(false)} onRecovery={onRecovery} onSignOut={onSignOut} /> : null}
    </main>
  );
}

export default function App() {
  const [accessMode, setAccessMode] = useState<"signIn" | "reset">("signIn");
  useUnhandledErrorReporting();

  async function signOutTo(mode: "signIn" | "reset") {
    setAccessMode(mode);
    const result = await authClient.signOut();
    if (result.error) throw new Error(result.error.message);
  }

  return (
    <>
      <AuthLoading><main className="loading-state full-screen"><LoaderCircle className="spin" size={22} />Securing your workspace</main></AuthLoading>
      <Unauthenticated><AccessScreen initialMode={accessMode} /></Unauthenticated>
      <Authenticated><EnrollmentGate onRecovery={() => signOutTo("reset")} onSignOut={() => signOutTo("signIn")} /></Authenticated>
    </>
  );
}
