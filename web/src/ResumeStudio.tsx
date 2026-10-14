import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { functions, type Job } from "./convex";

import { containsTerm, resumeTerms, tailoringBrief, parseResumeDraft, draftChanges, unsupportedDetails } from "./resumeTailoring";

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
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [providerConsent, setProviderConsent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    void fetch("/__career_ops/resume", { headers: { "X-Career-Ops-Local": "1" }, signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(status => { if (!controller.signal.aborted && status?.enabled && typeof status.model === "string") setLocalModel(status.model); })
      .catch(() => {});
    return () => { controller.abort(); generationRequest.current?.abort(); };
  }, []);
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

  const requested = useMemo(() => resumeTerms.filter((term) => containsTerm(description, term)), [description]);
  const covered = requested.filter((term) => containsTerm(resume, term));
  const missing = requested.filter((term) => !containsTerm(resume, term));
  const canExport = Boolean(job && resume.trim() && reviewed && !loading && !busy);
  const filename = `${job?.company || "company"}-${job?.title || "resume"}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadFile(text: string, name: string) {
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
  }

  const exportContext = useRef<{ jobId: string; resume: string; reviewed: boolean } | null>(null);
  exportContext.current = { jobId, resume, reviewed };
  useEffect(() => () => { exportContext.current = null; }, []);

  async function downloadWord() {
    if (!canExport) return;
    const snapshot = { jobId, resume };
    setBusy(true); setMessage("Preparing Word document…");
    try {
      // Load the document packer only when requested, keeping dashboard startup light.
      const { resumeDocument } = await import("./resumeDocument");
      const blob = await resumeDocument(snapshot.resume);
      const current = exportContext.current;
      if (!current || current.jobId !== snapshot.jobId || current.resume !== snapshot.resume || !current.reviewed) return;
      downloadBlob(blob, `${filename}.docx`);
      setMessage("Word document downloaded. Use the file format requested by the employer.");
    } catch {
      if (exportContext.current) setMessage("Could not create the Word document. Your draft is still here; try again or download text.");
    } finally { if (exportContext.current) setBusy(false); }
  }

  function download() {
    downloadFile(resume.trim() + "\n", `${filename}.txt`);
    setMessage("Resume downloaded. Use PDF if the employer does not accept text files.");
  }

  const importContext = useRef<object | null>(null);
  importContext.current = { jobId, sourceResume, description, resume };
  useEffect(() => () => { importContext.current = null; }, []);
  const changes = useMemo(() => draftChanges(sourceResume, resume), [sourceResume, resume]);
  const details = useMemo(() => unsupportedDetails(sourceResume, resume), [sourceResume, resume]);
  const newSkills = resumeTerms.filter(term => containsTerm(resume, term) && !containsTerm(sourceResume, term));

  async function generateDraft() {
    if (!job || !localModel || !providerConsent || busy || loading) return;
    if (resume.trim() && !window.confirm("Replace the current draft with a new GLM draft?")) return;
    const controller = new AbortController();
    generationRequest.current = controller;
    setBusy(true); setGenerating(true); setMessage("GLM is tailoring your evidence for this role. This can take up to three minutes…");
    try {
      const response = await fetch("/__career_ops/resume", { method: "POST",
        headers: { "Content-Type": "application/json", "X-Career-Ops-Local": "1" },
        signal: controller.signal,
        body: JSON.stringify({ consent: true, brief: tailoringBrief(job, sourceResume, description) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not generate a GLM draft.");
      const draft = parseResumeDraft(result.draft);
      if (controller.signal.aborted) return;
      setResume(draft); setReviewed(false); setDirty(true);
      setMessage("GLM draft ready. Review changed lines and facts, then save and export your resume.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not generate a GLM draft. Your editor is unchanged.");
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setGenerating(false); }
      if (generationRequest.current === controller) generationRequest.current = null;
    }
  }

  async function importDraft(file: File) {
    const context = importContext.current;
    try {
      if (!/\.txt$/i.test(file.name)) throw new Error("Choose a .txt draft saved as UTF-8 plain text.");
      if (file.size > 160000) throw new Error("Draft files must be smaller than 160 KB.");
      const draft = parseResumeDraft(await file.text());
      if (context !== importContext.current) return;
      if (resume.trim() && !window.confirm("Replace the current draft with the imported draft?")) return;
      setResume(draft); setReviewed(false); setDirty(true);
      setMessage("Draft imported. Review changed lines against your source resume before exporting.");
    } catch (error) {
      if (context === importContext.current) setMessage(error instanceof Error ? error.message : "Could not read the draft file.");
    }
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
        <div className="resume-evidence">
          <h3>Tailor with GLM</h3>
          {localModel ? <>
            <p>Your local OpenCode agent is connected. Generate a tailored draft directly into this editor, then review the facts before exporting.</p>
            <label><input type="checkbox" checked={providerConsent} onChange={event => setProviderConsent(event.target.checked)} />Send this source resume and posting to Z.AI through my local OpenCode Coding Plan agent.</label>
            <button type="button" className="button primary" disabled={!job || loading || !sourceResume.trim() || !description.trim() || !providerConsent} onClick={generateDraft}>{generating ? "Generating GLM draft…" : "Generate GLM draft"}</button>
            <p>Model: {localModel}. OpenCode keeps local session history. Signing out discards the returning draft; an already-started provider request may finish.</p>
          </> : <p>Download a brief, generate a draft with your local OpenCode Z.AI Coding Plan agent, then import the .txt file here to review and export it.</p>}
          <details><summary>Generate with the local runner</summary>
            <p>Sign in through <code>opencode auth login</code> and select Z.AI Coding Plan. Choose its model ID using <code>/models</code> in OpenCode. From the career-ops folder, run:</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>node web/scripts/tailor-resume.mjs --brief "path/to/downloaded-glm-brief.txt" --out "output/resume.txt" --model "zai-coding-plan/YOUR-MODEL-ID" --send-to-glm</pre>
            <p>Omit <code>--send-to-glm</code> to validate without an AI call. Use a new output filename for each draft. OpenCode retains local session history separately from your dashboard account.</p>
            <p>For generation directly in this editor, start the web development server with <code>CAREER_OPS_GLM_MODEL=zai-coding-plan/YOUR-MODEL-ID npm run dev -- --host 127.0.0.1</code>. Open that local dashboard and acknowledge provider sharing above.</p>
          </details>
          <p>The brief contains your source resume and posting. Sharing it with your agent sends that content to its AI provider.</p>
          <button type="button" className="button secondary" disabled={!job || loading || !sourceResume.trim() || !description.trim()} onClick={() => {
            if (!job) return;
            downloadFile(tailoringBrief({ company: job.company, title: job.title }, sourceResume, description), `${filename}-glm-brief.txt`);
            setMessage("Tailoring brief downloaded. Open it in your GLM agent; then import its plain text resume draft.");
          }}>Download GLM brief</button>
          <label>Import tailored draft<input type="file" accept=".txt,text/plain" style={{ maxWidth: "100%" }} aria-label="Import tailored draft" disabled={!job || loading || !sourceResume.trim() || !description.trim()} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void importDraft(file);
          }} /></label>
          <a href="https://docs.z.ai/devpack/tool/opencode" target="_blank" rel="noreferrer">OpenCode Coding Plan setup ↗</a>
        </div>
        <div className="resume-evidence" aria-live="polite"><h3>Keyword evidence</h3>{!description.trim() ? <p>Paste a job description to check common skills.</p> : !requested.length ? <p>No terms from the common-skills checklist found. Review this role’s requirements manually.</p> : <><p>{covered.length} of {requested.length} common skills appear in your resume. This is a literal text check, not an ATS score.</p><div className="resume-tags">{covered.map((term) => <span className="covered" key={term}>✓ {term}</span>)}{missing.map((term) => <span key={term}>Review: {term}</span>)}</div><p>Only add a missing skill when your experience supports it.</p></>}</div>
      </div>
      <div className="resume-draft">
        <label>Resume text<textarea aria-label="Resume text" disabled={!job || loading} rows={20} maxLength={40000} placeholder={"YOUR NAME\nEmail · Phone · Location\n\nSUMMARY\n\nEXPERIENCE\n\nEDUCATION\n\nSKILLS"} value={resume} onChange={(event) => { setResume(event.target.value); setReviewed(false); setDirty(true); setMessage(""); }} /></label>
        {sourceResume.trim() && resume.trim() && (details.figures.length > 0 || details.contacts.length > 0) && <div className="resume-evidence" role="status">
          <h3>Check details absent from your source</h3>
          {details.figures.length > 0 && <p>Numbers, dates, or metrics: {details.figures.join(", ")}</p>}
          {details.contacts.length > 0 && <p>Contact details or links: {details.contacts.join(", ")}</p>}
          <p>Verify each detail against your original evidence or remove it. Formatting changes may also appear here; this check cannot verify facts.</p>
        </div>}
        {sourceResume.trim() && resume.trim() && <details className="resume-evidence">
          <summary>Review {changes.length} changed or added lines against source</summary>
          <p>Check changed claims, dates, metrics, employers, and contact details against your original evidence. Wording changes can be valid; this comparison does not verify facts.</p>
          {newSkills.length > 0 && <p>Skills in the draft absent from source wording: {newSkills.join(", ")}. Verify supporting evidence or remove them.</p>}
          <ol style={{ overflowWrap: "anywhere" }}>{changes.map((line, index) => <li key={index}>{line}</li>)}</ol>
        </details>}
        <p className="resume-session-note">Save stores your source resume, job description, draft, and review state in your private account. Unsaved edits are cleared on refresh or sign-out. GLM generation shares evidence with Z.AI only after you choose it. Exported briefs and OpenCode history remain outside dashboard account deletion.</p>
        <label className="resume-review"><input type="checkbox" checked={reviewed} disabled={!job || loading} onChange={(event) => { setReviewed(event.target.checked); setDirty(true); }} />I reviewed the facts, contact details, and relevance for this role.</label>
        <div className="resume-export"><button type="button" className="button primary" disabled={!job || loading || !sourceResume.trim() || !description.trim() || !resume.trim() || !dirty} onClick={save}>{busy ? "Saving…" : "Save bundle"}</button><button type="button" className="button secondary" disabled={revision === null || loading} onClick={remove}>Delete saved bundle</button></div>
        <p>{revision === null ? "No saved bundle for this role." : `Saved revision ${revision}.`}{dirty ? " Unsaved changes." : ""}</p>
        <div className="resume-export"><button type="button" className="button primary" disabled={!canExport} onClick={downloadWord}><Download size={16} />Download Word</button><button type="button" className="button secondary" disabled={!canExport} onClick={download}><Download size={16} />Download text</button><button type="button" className="button secondary" disabled={!canExport} onClick={() => window.print()}><Printer size={16} />Print / Save PDF</button></div>
        <p role="status">{message || "PDF export uses your browser’s print dialog. Choose Save as PDF and turn off headers and footers."}</p>
      </div>
    </div>
    </fieldset>
    <article className="resume-print" aria-hidden="true"><pre>{resume.trim()}</pre></article>
  </section>;
}
