import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { functions, type Job } from "./convex";

// Conservative literal evidence check, not a prediction of an ATS score.
const terms = ["Python", "TypeScript", "JavaScript", "React", "Node.js", "SQL", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Linux", "CI/CD", "Git", "REST", "GraphQL", "security", "leadership", "stakeholder", "automation", "machine learning", "data analysis", "project management", "customer success", "Salesforce", "Excel", "communication"];
function containsTerm(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

export function ResumeStudio({ jobs }: { jobs: Job[] }) {
  const [jobId, setJobId] = useState("");
  const [resume, setResume] = useState("");
  const [description, setDescription] = useState("");
  const [sourceResume, setSourceResume] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadedJob, setLoadedJob] = useState("");
  const saved = useQuery(functions.getResumeBundle, jobId ? { jobId } : "skip");
  const saveBundle = useMutation(functions.saveResumeBundle);
  const removeBundle = useMutation(functions.removeResumeBundle);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const job = jobs.find((item) => item._id === jobId);
  const loading = Boolean(jobId && (saved === undefined || loadedJob !== jobId));

  useEffect(() => {
    if (!jobId || saved === undefined || loadedJob === jobId) return;
    setLoadedJob(jobId);
    setSourceResume(saved?.sourceResume ?? "");
    setDescription(saved?.description ?? "");
    setResume(saved?.resume ?? "");
    setRevision(saved?.revision ?? null);
    setReviewed(saved?.reviewedAt != null);
    setDirty(false);
  }, [jobId, saved, loadedJob]);

  function selectJob(next: string) {
    if (dirty && !window.confirm("Discard unsaved edits and switch roles?")) return;
    setLoadedJob("");
    setJobId(next);
    setResume(""); setDescription(""); setSourceResume("");
    setRevision(null); setReviewed(false); setDirty(false); setMessage("");
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const next = await saveBundle({ jobId, sourceResume, description, resume, reviewed, expectedRevision: revision });
      setRevision(next); setDirty(false);
      setMessage(`Bundle saved · revision ${next}. It will be here when you return.`);
    } catch {
      setMessage("Could not save. Your edits are still here. Another tab may have changed this bundle; download your draft before reloading.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!job || revision === null || !window.confirm(`Delete the saved resume bundle for ${job.company}? Your current editor text will remain until you leave.`)) return;
    setBusy(true);
    try {
      await removeBundle({ jobId, expectedRevision: revision });
      setRevision(null); setDirty(true); setMessage("Saved bundle deleted. Editor text remains unsaved.");
    } catch { setMessage("Could not delete. Reload to check the latest saved revision."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const requested = useMemo(() => terms.filter((term) => containsTerm(description, term)), [description]);
  const covered = requested.filter((term) => containsTerm(resume, term));
  const missing = requested.filter((term) => !containsTerm(resume, term));
  const canExport = Boolean(job && resume.trim() && reviewed && !loading && !busy);
  const filename = `${job?.company || "company"}-${job?.title || "resume"}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  function download() {
    const blob = new Blob([resume.trim() + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Resume downloaded. Use PDF if the employer does not accept text files.");
  }

  return <section className="pipeline-panel resume-studio" id="resume-studio" aria-labelledby="resume-studio-title">
    <header className="panel-header"><div><p className="eyebrow">Application desk</p><h2 id="resume-studio-title">Resume Studio</h2><p>Prepare a clear, single-column resume for one specific role.</p></div><FileText size={24} aria-hidden="true" /></header>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div className="resume-studio-body">
      <div className="resume-controls">
        <label>Target role<select aria-label="Resume target role" value={jobId} onChange={(event) => selectJob(event.target.value)}><option value="">Choose a pipeline role</option>{jobs.map((item) => <option key={item._id} value={item._id}>{item.company} · {item.title}</option>)}</select></label>
        {job && <a href={job.url} target="_blank" rel="noreferrer">Read the original posting ↗</a>}
        {!jobs.length && <p>Add a role to your pipeline to start preparing its resume.</p>}
        {loading && <p role="status">Loading saved bundle…</p>}
        <label>Source resume<textarea aria-label="Source resume" rows={6} maxLength={40000} disabled={!job || loading} placeholder="Paste your factual, original resume as evidence." value={sourceResume} onChange={(event) => { setSourceResume(event.target.value); setReviewed(false); setDirty(true); }} /></label>
        <button type="button" className="button secondary" disabled={!sourceResume.trim() || loading} onClick={() => { if (resume.trim() && !window.confirm("Replace the current draft with the source resume?")) return; setResume(sourceResume); setReviewed(false); setDirty(true); }}>Start draft from source</button>
        <label>Job description<textarea aria-label="Job description" disabled={!job || loading} rows={7} maxLength={40000} placeholder="Paste the requirements from the original posting." value={description} onChange={(event) => { setDescription(event.target.value); setReviewed(false); setDirty(true); }} /></label>
        <div className="resume-evidence" aria-live="polite"><h3>Keyword evidence</h3>{!description.trim() ? <p>Paste a job description to check common skills.</p> : !requested.length ? <p>No terms from the common-skills checklist found. Review this role’s requirements manually.</p> : <><p>{covered.length} of {requested.length} common skills appear in your resume. This is a literal text check, not an ATS score.</p><div className="resume-tags">{covered.map((term) => <span className="covered" key={term}>✓ {term}</span>)}{missing.map((term) => <span key={term}>Review: {term}</span>)}</div><p>Only add a missing skill when your experience supports it.</p></>}</div>
      </div>
      <div className="resume-draft">
        <label>Resume text<textarea aria-label="Resume text" disabled={!job || loading} rows={20} maxLength={40000} placeholder={"YOUR NAME\nEmail · Phone · Location\n\nSUMMARY\n\nEXPERIENCE\n\nEDUCATION\n\nSKILLS"} value={resume} onChange={(event) => { setResume(event.target.value); setReviewed(false); setDirty(true); setMessage(""); }} /></label>
        <p className="resume-session-note">Save stores your source resume, job description, draft, and review state in your private account. Unsaved edits are cleared on refresh or sign-out. No AI provider receives this content.</p>
        <label className="resume-review"><input type="checkbox" checked={reviewed} disabled={!job || loading} onChange={(event) => { setReviewed(event.target.checked); setDirty(true); }} />I reviewed the facts, contact details, and relevance for this role.</label>
        <div className="resume-export"><button type="button" className="button primary" disabled={!job || loading || !sourceResume.trim() || !description.trim() || !resume.trim() || !dirty} onClick={save}>{busy ? "Saving…" : "Save bundle"}</button><button type="button" className="button secondary" disabled={revision === null || loading} onClick={remove}>Delete saved bundle</button></div>
        <p>{revision === null ? "No saved bundle for this role." : `Saved revision ${revision}.`}{dirty ? " Unsaved changes." : ""}</p>
        <div className="resume-export"><button type="button" className="button primary" disabled={!canExport} onClick={download}><Download size={16} />Download text</button><button type="button" className="button secondary" disabled={!canExport} onClick={() => window.print()}><Printer size={16} />Print / Save PDF</button></div>
        <p role="status">{message || "PDF export uses your browser’s print dialog. Choose Save as PDF and turn off headers and footers."}</p>
      </div>
    </div>
    </fieldset>
    <article className="resume-print" aria-hidden="true"><pre>{resume.trim()}</pre></article>
  </section>;
}
