import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowUpRight, Check, X } from "lucide-react";
import { functions, type Job } from "./convex";

function goToProfile() {
  const field = document.querySelector<HTMLInputElement>('#discovery-settings input[required]');
  const target = document.querySelector<HTMLElement>('#discovery-settings');
  target?.scrollIntoView({ block: "start" });
  field?.focus({ preventScroll: true });
}

export function BetaGuide({ jobs, onAdd, onPrepare }: { jobs: Job[] | undefined; onAdd: () => void; onPrepare: (id: string) => void }) {
  const profile = useQuery(functions.getTargetProfile, {});
  const summaries = useQuery(functions.listResumeSummaries, {});
  const loading = jobs === undefined || profile === undefined || summaries === undefined;
  const ownedSummaries = summaries?.filter(item => jobs?.some(job => job._id === item.jobId)) ?? [];
  const ready = ownedSummaries.find(item => item.reviewedAt !== null);
  const firstRole = jobs?.find(job => !["applied", "interview", "offer", "rejected", "discarded"].includes(job.status)) ?? jobs?.[0];
  const steps = [
    { title: "Choose your starting point", detail: "Set job targets, or add a role directly.", done: Boolean(profile || jobs?.length) },
    { title: "Pick a real opportunity", detail: "Review a discovered role or paste an employer link.", done: Boolean(jobs?.length) },
    { title: "Prepare and save a draft", detail: "Start with your original resume and the job description.", done: ownedSummaries.length > 0 },
    { title: "Review the facts", detail: "Save your reviewed draft, then export Word or PDF.", done: Boolean(ready) },
  ];
  const completed = steps.filter(step => step.done).length;
  const next = steps.findIndex(step => !step.done);
  const label = next === 0 ? "Set my job targets" : next === 1 ? "Add my first role" : ready ? "Open reviewed resume" : "Prepare my resume";
  function continueSetup() {
    if (loading) return;
    if (next === 0) goToProfile();
    else if (next === 1 || !firstRole) onAdd();
    else onPrepare(ready?.jobId ?? firstRole._id);
  }
  return <section className="beta-guide" aria-labelledby="beta-guide-title">
    <div className="beta-guide-intro"><p className="eyebrow">Your first application</p><h2 id="beta-guide-title">A clear next move.</h2>
      <p>Find a role worth your time. Build a factual resume. You decide when to apply.</p>
      <p className="beta-progress" role="status">{loading ? "Loading your saved progress…" : `${completed} of 4 steps complete`}</p>
      <button className="button primary" disabled={loading} onClick={continueSetup} type="button">{label}<ArrowUpRight size={15} /></button>
      {next === 0 && <button className="text-button" onClick={onAdd} type="button">I already have a job to add</button>}
    </div><ol className="beta-steps">{steps.map((step, index) => <li key={step.title} aria-current={!loading && index === next ? "step" : undefined}>
      <span className={`beta-step-number${!loading && step.done ? " complete" : ""}`}>{!loading && step.done ? <Check size={15} aria-label="Complete" /> : index + 1}</span>
      <div><strong>{step.title}</strong><p>{step.detail}</p></div>
    </li>)}</ol>
  </section>;
}

export function BetaHelp({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const notes = `Meritwake beta feedback\nVersion: ${import.meta.env.VITE_APP_DEPLOYMENT_VERSION || "local-development"}\n\nWhat were you trying to do?\n\nWhat happened?\n\nWhat did you expect?\n\nPlease omit resumes, passwords, invite codes, verification links and other personal details.`;
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(notes); setCopied(true); }
    catch { setCopied(false); }
  }
  return <dialog className="dialog beta-help" ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="beta-help-title">
    <header><div><p className="eyebrow">Beta fieldnotes</p><h2 id="beta-help-title">A quick guide to Meritwake</h2></div><button className="icon-button" onClick={onClose} aria-label="Close beta guide" type="button"><X size={18} /></button></header>
    <h3>Start with one real role</h3><p>Use Target Profile and discovery, or Add role for a posting from any employer. Public feed coverage is limited; no results does not mean there are no suitable jobs.</p>
    <h3>Bring your original evidence</h3><p>Import a text or Markdown resume, or paste text from a PDF or Word document. Reuse a saved source across applications. Keep license numbers and other sensitive details out unless needed.</p>
    <h3>Tailor, review, export</h3><p>Local AI tailoring appears when your workspace is connected. Hosted AI generation is not connected in this beta build; you can edit manually or import a draft. Check every claim before downloading Word or saving a PDF. Nothing submits applications for you.</p>
    <h3>Help us find the rough edges</h3><p>Send your beta contact the step you tried, what happened, and what you expected. Screenshots should hide personal details.</p>
    <label className="beta-feedback-label">Feedback template<textarea aria-label="Beta feedback template" readOnly rows={7} value={notes} /></label>
    <button className="button secondary" type="button" onClick={copy}>{copied ? "Template copied" : "Copy feedback template"}</button>
    <p className="beta-help-footnote">Copying sends nothing. You choose where to share it. Your progress comes from saved account data; unsaved edits can be lost on refresh.</p>
  </dialog>;
}
