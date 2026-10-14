import { useMemo, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import type { Job } from "./convex";

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
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const job = jobs.find((item) => item._id === jobId);
  const requested = useMemo(() => terms.filter((term) => containsTerm(description, term)), [description]);
  const covered = requested.filter((term) => containsTerm(resume, term));
  const missing = requested.filter((term) => !containsTerm(resume, term));
  const canExport = Boolean(job && resume.trim() && reviewed);
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
    <div className="resume-studio-body">
      <div className="resume-controls">
        <label>Target role<select aria-label="Resume target role" value={jobId} onChange={(event) => { setJobId(event.target.value); setDescription(""); setReviewed(false); setMessage(""); }}><option value="">Choose a pipeline role</option>{jobs.map((item) => <option key={item._id} value={item._id}>{item.company} · {item.title}</option>)}</select></label>
        {job && <a href={job.url} target="_blank" rel="noreferrer">Read the original posting ↗</a>}
        {!jobs.length && <p>Add a role to your pipeline to start preparing its resume.</p>}
        <label>Job description<textarea aria-label="Job description" rows={7} maxLength={40000} placeholder="Paste the requirements from the original posting." value={description} onChange={(event) => { setDescription(event.target.value); setReviewed(false); }} /></label>
        <div className="resume-evidence" aria-live="polite"><h3>Keyword evidence</h3>{!description.trim() ? <p>Paste a job description to check common skills.</p> : !requested.length ? <p>No terms from the common-skills checklist found. Review this role’s requirements manually.</p> : <><p>{covered.length} of {requested.length} common skills appear in your resume. This is a literal text check, not an ATS score.</p><div className="resume-tags">{covered.map((term) => <span className="covered" key={term}>✓ {term}</span>)}{missing.map((term) => <span key={term}>Review: {term}</span>)}</div><p>Only add a missing skill when your experience supports it.</p></>}</div>
      </div>
      <div className="resume-draft">
        <label>Resume text<textarea aria-label="Resume text" rows={20} maxLength={40000} placeholder={"YOUR NAME\nEmail · Phone · Location\n\nSUMMARY\n\nEXPERIENCE\n\nEDUCATION\n\nSKILLS"} value={resume} onChange={(event) => { setResume(event.target.value); setReviewed(false); setMessage(""); }} /></label>
        <p className="resume-session-note">Paste your existing resume and edit for this role. Text stays in this browser session and is cleared on refresh or sign-out. No AI processing runs here yet.</p>
        <label className="resume-review"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the facts, contact details, and relevance for this role.</label>
        <div className="resume-export"><button type="button" className="button primary" disabled={!canExport} onClick={download}><Download size={16} />Download text</button><button type="button" className="button secondary" disabled={!canExport} onClick={() => window.print()}><Printer size={16} />Print / Save PDF</button></div>
        <p role="status">{message || "PDF export uses your browser’s print dialog. Choose Save as PDF and turn off headers and footers."}</p>
      </div>
    </div>
    <article className="resume-print" aria-hidden="true"><pre>{resume.trim()}</pre></article>
  </section>;
}
