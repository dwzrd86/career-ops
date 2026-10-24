import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Download, FileText, Printer } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { functions, type Job } from "./convex";

import { HOSTED_CONSENT_VERSION, containsTerm, resumeTerms, tailoringBrief, parseResumeDraft, draftChanges, unsupportedDetails, parseChecklistTerms } from "./resumeTailoring";

export type ResumeStudioHandle = { openJob: (jobId: string) => void };

export function ResumeStudio({ jobs, ref }: { jobs: Job[]; ref?: Ref<ResumeStudioHandle> }) {
  const targetSelect = useRef<HTMLSelectElement>(null);
  const sourceEditor = useRef<HTMLTextAreaElement>(null);
  const postingEditor = useRef<HTMLTextAreaElement>(null);
  const draftEditor = useRef<HTMLTextAreaElement>(null);
  const tailoringPanel = useRef<HTMLDivElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const wordButton = useRef<HTMLButtonElement>(null);
  const [jobId, setJobId] = useState("");
  const [resume, setResume] = useState("");
  const [description, setDescription] = useState("");
  const [sourceResume, setSourceResume] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadedJob, setLoadedJob] = useState("");
  const saved = useQuery(functions.getResumeBundle, jobId ? { jobId } : "skip");
  const summaries = useQuery(functions.listResumeSummaries, {});
  const [shelfFilter, setShelfFilter] = useState("ready");
  const sources = useQuery(functions.listResumeSources, {});
  const saveBundle = useMutation(functions.saveResumeBundle);
  const removeBundle = useMutation(functions.removeResumeBundle);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [providerConsent, setProviderConsent] = useState(false);
  const hostedAvailability = useQuery(functions.hostedResumeAvailability, {});
  const requestHosted = useMutation(functions.requestHostedResume);
  const [hostedRequestId, setHostedRequestId] = useState<string | null>(null);
  const hostedStatus = useQuery(functions.hostedResumeStatus, hostedRequestId ? { requestId: hostedRequestId } : "skip");
  const hostedContext = useRef<{ jobId: string; company: string; title: string; revision: number; sourceResume: string; description: string; resume: string } | null>(null);
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
  // Consent applies to the selected evidence, not every future role or resume.
  useEffect(() => { setProviderConsent(false); }, [jobId, job?.company, job?.title, sourceResume, description, localModel]);
  const shelf = (summaries ?? []).flatMap(summary => {
    const role = jobs.find(item => item._id === summary.jobId);
    return role && !["applied", "interview", "offer", "rejected", "discarded"].includes(role.status)
      ? [{ ...summary, role }] : [];
  });
  const readyCount = shelf.filter(item => item.reviewedAt !== null).length;
  const loading = Boolean(jobId && (saved === undefined || loadedJob !== jobId));

  useEffect(() => {
    if (!jobId || !job || saved === undefined || loadedJob === jobId) return;
    setLoadedJob(jobId);
    setSourceResume(saved?.sourceResume ?? "");
    setDescription(saved?.description ?? job.postingText ?? "");
    setResume(saved?.resume ?? "");
    setRevision(saved?.revision ?? null);
    setReviewed(saved?.reviewedAt != null);
    setDirty(false);
  }, [jobId, saved, loadedJob, job]);

  function selectJob(next: string) {
    if (busy) return false;
    if (next === jobId) return true;
    if (dirty && !window.confirm("Discard unsaved edits and switch roles?")) return false;
    setLoadedJob("");
    setJobId(next);
    setResume(""); setDescription(""); setSourceResume("");
    setChecklistText("");
    setRevision(null); setReviewed(false); setDirty(false); setMessage("");
    return true;
  }

  useImperativeHandle(ref, () => ({
    openJob(next: string) {
      if (!jobs.some(item => item._id === next)) return;
      if (!selectJob(next)) return;
      targetSelect.current?.scrollIntoView({ block: "center" });
      targetSelect.current?.focus({ preventScroll: true });
    },
  }));

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

  const checklist = useMemo(() => {
    try { return { terms: parseChecklistTerms(checklistText), error: "" }; }
    catch (error) { return { terms: [] as string[], error: error instanceof Error ? error.message : "Check the terms." }; }
  }, [checklistText]);
  const requested = useMemo(() => checklistText.trim() ? checklist.terms : resumeTerms.filter(term => containsTerm(description, term)), [checklistText, checklist.terms, description]);
  const covered = requested.filter((term) => containsTerm(resume, term));
  const missing = requested.filter((term) => !containsTerm(resume, term));
  const canExport = Boolean(job && resume.trim() && reviewed && !loading && !busy);
  const preparationSteps = [
    { label: "Source evidence", complete: Boolean(sourceResume.trim()), action: "Add source resume", target: sourceEditor },
    { label: "Job posting", complete: Boolean(description.trim()), action: "Add job description", target: postingEditor },
    { label: "Tailored draft", complete: Boolean(resume.trim()), action: "Prepare tailored draft", target: tailoringPanel },
    { label: "Factual review", complete: reviewed, action: "Review resume facts", target: draftEditor },
    { label: "Saved bundle", complete: revision !== null && !dirty, action: "Save reviewed bundle", target: saveButton },
  ];
  const nextStep = preparationSteps.find(step => !step.complete);
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
  const editorSnapshot = useMemo(() => ({ jobId, sourceResume, description, resume, busy, loading, reviewed, revision }),
    [jobId, sourceResume, description, resume, busy, loading, reviewed, revision]);
  importContext.current = editorSnapshot;
  useEffect(() => () => { importContext.current = null; }, []);
  const changes = useMemo(() => draftChanges(sourceResume, resume), [sourceResume, resume]);
  const details = useMemo(() => unsupportedDetails(sourceResume, resume), [sourceResume, resume]);
  const newSkills = [...new Set([...resumeTerms, ...requested])].filter(term => containsTerm(resume, term) && !containsTerm(sourceResume, term));

  // The fieldset locks edits/navigation while waiting. Recheck identity and the
  // exact saved revision too: other tabs and pipeline changes remain possible.
  useEffect(() => {
    if (!hostedRequestId || hostedStatus === undefined || hostedStatus?.status === "pending") return;
    const context = hostedContext.current;
    if (hostedStatus?.status === "succeeded" && saved?.revision === (context?.revision ?? 0) + 1
      && context && jobId === context.jobId && job?.company === context.company && job?.title === context.title
      && revision === context.revision && sourceResume === context.sourceResume
      && description === context.description && resume === context.resume
      && saved.sourceResume === sourceResume && saved.description === description && saved.reviewedAt === null) {
      setResume(saved.resume); setRevision(saved.revision); setReviewed(false); setDirty(false);
      setMessage("Hosted GLM draft saved. Review changed lines and facts before approving and exporting.");
    } else if (hostedStatus?.status === "succeeded" && saved?.revision === context?.revision) {
      return; // Wait for the reactive bundle query to catch up with completion.
    } else {
      const failures: Record<string, string> = {
        providerTimeout: "Provider timed out. Its charge may remain reserved; retry can be unavailable until reconciliation.",
        providerBalance: "Provider balance is unavailable. Contact the pilot operator.",
        providerRateLimited: "Provider rate limit reached. Wait before explicitly trying again.",
        providerOverloaded: "Provider is busy. Wait before explicitly trying again.",
        invalidDraft: "Provider output failed validation. No draft was applied.",
        staleEvidence: "The saved role or evidence changed. Reload the saved bundle before trying again.",
        accessRevoked: "Generation access changed. Check enrollment and privacy acknowledgement.",
      };
      setMessage(hostedStatus?.status === "failed"
        ? (failures[hostedStatus.failureCode ?? ""] ?? "Hosted generation could not finish. Check availability below before explicitly retrying.")
        : "The saved bundle changed. Your editor was retained; download unsaved work before reloading the saved bundle.");
      setReviewed(false);
    }
    setProviderConsent(false); setBusy(false); setGenerating(false);
    setHostedRequestId(null); hostedContext.current = null;
  }, [hostedRequestId, hostedStatus, saved, jobId, job?.company, job?.title, revision, sourceResume, description, resume]);

  async function generateHostedDraft() {
    if (!job || busy || loading || dirty || revision === null || !providerConsent || hostedAvailability?.reason !== "ready" || hostedAvailability.pending) return;
    if (resume.trim() && !window.confirm("Replace the saved draft with a hosted GLM draft? Factual review will be cleared.")) return;
    const context = { jobId, company: job.company, title: job.title, revision, sourceResume, description, resume };
    hostedContext.current = context;
    setBusy(true); setGenerating(true); setMessage("Requesting a hosted GLM draft…");
    try {
      const requestId = await requestHosted({ jobId, expectedRevision: revision, consent: {
        provider: "zai", model: "glm-4.7", version: HOSTED_CONSENT_VERSION, shareSelectedEvidence: true,
      } });
      if (!importContext.current) return; // Signed out or unmounted.
      setReviewed(false); setHostedRequestId(requestId);
      setMessage("Hosted generation pending. You can sign out and return to the saved bundle; an admitted request may still be charged.");
    } catch {
      if (!importContext.current) return;
      hostedContext.current = null; setBusy(false); setGenerating(false); setProviderConsent(false);
      setMessage("Could not queue this draft. Check the saved revision, enrollment, privacy acknowledgement and availability before retrying. Your editor is unchanged.");
    }
  }

  const localGenerationContext = useMemo(() => ({ jobId, company: job?.company, title: job?.title, sourceResume, description, resume, revision, savedRevision: saved?.revision }),
    [jobId, job?.company, job?.title, sourceResume, description, resume, revision, saved?.revision]);
  const localContext = useRef<typeof localGenerationContext | null>(null);
  localContext.current = localGenerationContext;
  useEffect(() => () => { localContext.current = null; }, []);

  async function generateDraft() {
    if (!job || !localModel || !providerConsent || busy || loading) return;
    if (resume.trim() && !window.confirm("Replace the current draft with a new GLM draft?")) return;
    const context = localContext.current;
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
      if (context !== localContext.current) { setMessage("The role or saved evidence changed. Your editor was retained; generate again from the current evidence."); return; }
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

  const sourceImportRequest = useRef<object | null>(null);
  async function importSource(file: File) {
    if (!job || loading || busy) return;
    const context = importContext.current;
    const request = {};
    sourceImportRequest.current = request;
    const isCurrent = () => context === importContext.current && request === sourceImportRequest.current;
    try {
      if (!/\.(txt|md)$/i.test(file.name)) throw new Error("Choose a .txt or .md source resume saved as UTF-8 plain text. For PDF or Word, copy its text into Source resume.");
      if (file.size > 160000) throw new Error("Source resume files must be smaller than 160 KB.");
      const text = parseResumeDraft(await file.text(), "source resume");
      if (!isCurrent()) return;
      if (sourceResume.trim() && sourceResume !== text && !window.confirm("Replace this role's source resume with the imported evidence? Your draft will remain for review.")) return;
      setSourceResume(text); setReviewed(false); setDirty(true);
      setMessage("Source resume imported locally. Check the text, then prepare your draft. Save bundle to store it in your private account.");
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "Could not read the source resume. Your editor is unchanged.");
    }
  }

  return <section className="pipeline-panel resume-studio" id="resume-studio" aria-labelledby="resume-studio-title">
    <header className="panel-header"><div><p className="eyebrow">Application desk</p><h2 id="resume-studio-title">Resume Studio</h2><p>Prepare a clear, single-column resume for one specific role.</p></div><FileText size={24} aria-hidden="true" /></header>
    <fieldset disabled={busy} className="resume-fieldset">
    <section className="resume-preparation" aria-labelledby="resume-preparation-title">
      <h3 id="resume-preparation-title">Prepare this application</h3>
      <p role="status">{!job ? "Choose a pipeline role to start." : loading ? "Loading this role’s preparation…" : busy ? "Finishing the current operation…" : nextStep ? `Next: ${nextStep.action}.` : "Reviewed and saved. Your resume is ready to export."}</p>
      {job && !loading && <ol aria-label="Resume preparation checklist">{preparationSteps.map(step => <li key={step.label} aria-current={step === nextStep ? "step" : undefined}>
        <span aria-hidden="true">{step.complete ? "✓" : "○"}</span> {step.label}<span className="sr-only">: {step.complete ? "Complete" : "Pending"}</span>
      </li>)}</ol>}
      <button type="button" className="button secondary" disabled={loading} onClick={() => {
        const element = !job ? targetSelect.current : nextStep ? nextStep.target.current : wordButton.current;
        element?.scrollIntoView({ block: "center" });
        element?.focus({ preventScroll: true });
      }}>{!job ? "Choose target role" : nextStep?.action ?? "Export reviewed resume"}</button>
      {job && !loading && <p>Review changed claims against your source before checking factual review. Save your bundle to keep it in the resume queue. Navigation never sends evidence to GLM.</p>}
    </section>
    <section className="resume-shelf" aria-labelledby="resume-shelf-title">
      <h3 id="resume-shelf-title">Your resume queue</h3>
      <p>Saved resumes for roles you haven’t applied to yet. Ready means you reviewed the saved facts; check that the posting is still open before applying.</p>
      <div className="resume-export" role="group" aria-label="Resume queue filters">
        <button type="button" className="button secondary" aria-pressed={shelfFilter === "ready"} onClick={() => setShelfFilter("ready")}>Ready to export ({readyCount})</button>
        <button type="button" className="button secondary" aria-pressed={shelfFilter === "review"} onClick={() => setShelfFilter("review")}>Needs review ({shelf.length - readyCount})</button>
      </div>
      {summaries === undefined ? <p role="status">Loading resume queue…</p> : <>
        {!shelf.some(item => (item.reviewedAt !== null) === (shelfFilter === "ready")) && <p>{shelfFilter === "ready" ? "No reviewed resumes ready yet. Choose a role below, prepare its draft, review the facts, and save." : "No saved drafts waiting for review."}</p>}
        <ul className="resume-shelf-list">{shelf.filter(item => (item.reviewedAt !== null) === (shelfFilter === "ready")).map(item => <li key={item.jobId}>
          <div><strong>{item.role.company} · {item.role.title}</strong><p>Revision {item.revision} · Saved {new Date(item.updatedAt).toLocaleDateString()}{item.jobId === jobId && dirty ? " · Unsaved editor changes" : ""}</p></div>
          <button type="button" className="button secondary" disabled={loading} onClick={() => selectJob(item.jobId)}>{item.reviewedAt !== null ? "Open for export" : "Review draft"}<span className="sr-only"> for {item.role.company} · {item.role.title}</span></button>
        </li>)}</ul>
      </>}
    </section>
    <div className="resume-studio-body">
      <div className="resume-controls">
        <label>Target role<select ref={targetSelect} aria-label="Resume target role" value={jobId} onChange={(event) => selectJob(event.target.value)}><option value="">Choose a pipeline role</option>{jobs.map((item) => <option key={item._id} value={item._id}>{item.company} · {item.title}</option>)}</select></label>
        {job && <a href={job.url} target="_blank" rel="noreferrer">Read the original posting ↗</a>}
        {!jobs.length && <p>Add a role to your pipeline to start preparing its resume.</p>}
        {loading && <p role="status">Loading saved bundle…</p>}
        <label>Reuse saved source resume<select aria-label="Reuse saved source resume" value="" disabled={!job || loading || !sources?.length} onChange={event => {
          const source = sources?.find(item => item.jobId === event.target.value);
          if (!source) return;
          if (sourceResume.trim() && sourceResume !== source.sourceResume && !window.confirm("Replace this role's source resume with the selected saved evidence? Your draft will remain for review.")) return;
          setSourceResume(source.sourceResume); setReviewed(false); setDirty(true);
          setMessage(`Source evidence reused from ${source.company} · ${source.title}. Review your draft against this source before exporting.`);
        }}><option value="">{sources === undefined ? "Loading saved sources…" : sources.length ? "Choose original evidence from a saved bundle" : "Save a bundle once to reuse its source here"}</option>{sources?.map(item => <option key={item.jobId} value={item.jobId}>{item.company} · {item.title}</option>)}</select></label>
        <p>Reuse your original resume across roles. Saved sources stay in your private account; choosing one resets this role’s factual review.</p>
        <label>Import source resume<input aria-label="Import source resume" type="file" accept=".txt,.md,text/plain,text/markdown" disabled={!job || loading} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importSource(file);
        }} /></label>
        <p>Choose a UTF-8 text or Markdown resume (up to 40,000 characters). Files are read in your browser. For PDF or Word, copy and paste the document’s text below.</p>
        <label>Source resume<textarea ref={sourceEditor} aria-label="Source resume" rows={6} maxLength={40000} disabled={!job || loading} placeholder="Paste your factual, original resume as evidence." value={sourceResume} onChange={(event) => { setSourceResume(event.target.value); setReviewed(false); setDirty(true); }} /></label>
        <button type="button" className="button secondary" disabled={!sourceResume.trim() || loading} onClick={() => { if (resume.trim() && !window.confirm("Replace the current draft with the source resume?")) return; setResume(sourceResume); setReviewed(false); setDirty(true); }}>Start draft from source</button>
        {job?.postingText && <p>Discovery captured this posting’s text. Check the original for updates before generating or applying. Saved edits take priority.</p>}
        <label>Job description<textarea ref={postingEditor} aria-label="Job description" disabled={!job || loading} rows={7} maxLength={40000} placeholder="Paste the requirements from the original posting." value={description} onChange={(event) => { setDescription(event.target.value); setReviewed(false); setDirty(true); }} /></label>
        <div ref={tailoringPanel} tabIndex={-1} className="resume-evidence">
          <h3>Tailor with GLM</h3>
          <h4>Hosted generation · Z.ai glm-4.7</h4>
          <p role="status">{!hostedAvailability ? "Checking hosted generation availability…" : hostedAvailability.pending ? "A hosted request is pending for your account. Return to its saved role after it finishes." : hostedAvailability.reason === "quota" ? "Monthly quota exhausted. Attempts reset at the start of the next UTC calendar month." : hostedAvailability.reason === "budget" ? "The shared AI budget is exhausted. Generation is paused until budget is available." : hostedAvailability.reason === "unavailable" ? "Hosted generation is unavailable. Pilot enrollment, provider configuration, pricing or unresolved usage may need operator attention." : "Hosted generation is available."} {hostedAvailability && `${hostedAvailability.remaining} of 20 attempts remaining this UTC month.`}</p>
          <p>Start a draft from your source and save the bundle first. Save any edits before generating. Selected evidence goes to Z.ai Standard API; no local agent or downloaded brief is needed. Explicit retries consume another attempt and may incur another charge.</p>
          {!localModel && <label><input type="checkbox" checked={providerConsent} onChange={event => setProviderConsent(event.target.checked)} />Share this saved source resume and posting with Z.ai Standard API for this hosted draft.</label>}
          {!localModel && <button type="button" className="button primary" disabled={!job || loading || dirty || revision === null || !providerConsent || hostedAvailability?.reason !== "ready" || hostedAvailability.pending} onClick={generateHostedDraft}>{generating ? "Generating hosted draft…" : "Generate hosted GLM draft"}</button>}
          {revision !== null && saved && saved.revision !== revision && !busy && <button type="button" className="button secondary" onClick={() => {
            if (dirty && !window.confirm("Discard editor edits and reload the saved bundle? Download your draft first if needed.")) return;
            setLoadedJob(""); setMessage("Saved bundle reloaded. Review its facts before export.");
          }}>Reload saved bundle</button>}
          {localModel ? <>
            <p>Your local OpenCode agent is connected. Generate a tailored draft directly into this editor, then review the facts before exporting.</p>
            <label><input type="checkbox" checked={providerConsent} onChange={event => setProviderConsent(event.target.checked)} />Send this source resume and posting to Z.AI through my local OpenCode Coding Plan agent.</label>
            <p>Sharing permission resets when you change the role, source resume, or posting. Pipeline notes and account metadata are excluded from the brief.</p>
            <button type="button" className="button primary" disabled={!job || loading || !sourceResume.trim() || !description.trim() || !providerConsent} onClick={generateDraft}>{generating ? "Generating GLM draft…" : "Generate GLM draft"}</button>
            <p>Model: {localModel}. OpenCode keeps local session history. Signing out discards the returning draft; an already-started provider request may finish.</p>
          </> : <p>Download a brief, generate a draft with your local OpenCode Z.AI Coding Plan agent, then import the .txt file here to review and export it.</p>}
          <details><summary>Generate with the local runner</summary>
            <p>Sign in through <code>opencode auth login</code> and select Z.AI Coding Plan. Choose its model ID using <code>/models</code> in OpenCode. From the career-ops folder, run:</p>
            <pre className="resume-command">node web/scripts/tailor-resume.mjs --brief "path/to/downloaded-glm-brief.txt" --out "output/resume.txt" --model "zai-coding-plan/YOUR-MODEL-ID" --send-to-glm</pre>
            <p>Omit <code>--send-to-glm</code> to validate without an AI call. Use a new output filename for each draft. OpenCode retains local session history separately from your dashboard account.</p>
            <p>For generation directly in this editor, start the web development server with <code>CAREER_OPS_GLM_MODEL=zai-coding-plan/YOUR-MODEL-ID npm run dev -- --host 127.0.0.1</code>. Open that local dashboard and acknowledge provider sharing above.</p>
          </details>
          <p>The brief contains your source resume and posting. Sharing it with your agent sends that content to its AI provider.</p>
          <button type="button" className="button secondary" disabled={!job || loading || !sourceResume.trim() || !description.trim()} onClick={() => {
            if (!job) return;
            downloadFile(tailoringBrief({ company: job.company, title: job.title }, sourceResume, description), `${filename}-glm-brief.txt`);
            setMessage("Tailoring brief downloaded. Open it in your GLM agent; then import its plain text resume draft.");
          }}>Download GLM brief</button>
          <label>Import tailored draft<input type="file" accept=".txt,text/plain" className="resume-import" aria-label="Import tailored draft" disabled={!job || loading || !sourceResume.trim() || !description.trim()} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void importDraft(file);
          }} /></label>
          <a href="https://docs.z.ai/devpack/tool/opencode" target="_blank" rel="noreferrer">OpenCode Coding Plan setup ↗</a>
        </div>
        <div className="resume-evidence"><h3>Keyword evidence</h3>
          <label>Role-specific terms (one per line)<textarea aria-label="Role-specific terms" rows={3} maxLength={3200} disabled={!job || loading} placeholder={"Examples: patient care, forklift operation, classroom planning. Put each term on a separate line."} value={checklistText} onChange={event => {
            setChecklistText(event.target.value);
            if (reviewed) { setReviewed(false); setDirty(true); }
          }} /></label>
          <p>Use terms from this posting for any profession. Up to 40 terms, 80 characters each. This temporary checklist resets on role change or refresh; it is not included in saved bundles or AI briefs.</p>
          <div aria-live="polite">{checklist.error ? <p className="form-error" role="alert">{checklist.error}</p> : !description.trim() ? <p>Paste a job description to check common skills.</p> : !requested.length ? <p>No terms from the common-skills checklist found. Add role-specific terms or review this role’s requirements manually.</p> : <><p>{covered.length} of {requested.length} {checklistText.trim() ? "selected terms" : "common skills"} appear in your resume. This is a literal text check, not an ATS score.</p><div className="resume-tags">{covered.map((term) => <span className="covered" key={term}>✓ {term}</span>)}{missing.map((term) => <span key={term}>Review: {term}</span>)}</div><p>A text match does not verify a license, certification, eligibility, or skill. Only add claims your original evidence supports.</p></>}</div>
        </div>
      </div>
      <div className="resume-draft">
        <label>Resume text<textarea ref={draftEditor} aria-label="Resume text" disabled={!job || loading} rows={20} maxLength={40000} placeholder={"YOUR NAME\nEmail · Phone · Location\n\nSUMMARY\n\nEXPERIENCE\n\nEDUCATION\n\nSKILLS"} value={resume} onChange={(event) => { setResume(event.target.value); setReviewed(false); setDirty(true); setMessage(""); }} /></label>
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
          <ol className="resume-changes">{changes.map((line, index) => <li key={index}>{line}</li>)}</ol>
        </details>}
        <p className="resume-session-note">Save stores your source resume, job description, draft, and review state in your private account. Unsaved edits are cleared on refresh or sign-out. GLM generation shares evidence with Z.AI only after you choose it. Exported briefs and OpenCode history remain outside dashboard account deletion.</p>
        <label className="resume-review"><input type="checkbox" checked={reviewed} disabled={!job || loading} onChange={(event) => { setReviewed(event.target.checked); setDirty(true); }} />I reviewed the facts, contact details, and relevance for this role.</label>
        <div className="resume-export"><button type="button" className="button primary" ref={saveButton} disabled={!job || loading || !sourceResume.trim() || !description.trim() || !resume.trim() || !dirty} onClick={save}>{busy ? "Saving…" : "Save bundle"}</button><button type="button" className="button secondary" disabled={revision === null || loading} onClick={remove}>Delete saved bundle</button></div>
        <p>{revision === null ? "No saved bundle for this role." : `Saved revision ${revision}.`}{dirty ? " Unsaved changes." : ""}</p>
        <div className="resume-export"><button type="button" className="button primary" ref={wordButton} disabled={!canExport} onClick={downloadWord}><Download size={16} />Download Word</button><button type="button" className="button secondary" disabled={!canExport} onClick={download}><Download size={16} />Download text</button><button type="button" className="button secondary" disabled={!canExport} onClick={() => window.print()}><Printer size={16} />Print / Save PDF</button></div>
        <p role="status">{message || "PDF export uses your browser’s print dialog. Choose Save as PDF and turn off headers and footers."}</p>
      </div>
    </div>
    </fieldset>
    <article className="resume-print">{canExport
      ? <pre>{resume.trim()}</pre>
      : <p>Select a role and review its resume facts in Resume Studio before printing or saving a PDF.</p>}
    </article>
  </section>;
}
