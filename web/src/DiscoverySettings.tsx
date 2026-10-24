import { useMutation, useQuery } from "convex/react";
import { Check, FileUp, LoaderCircle, Play, Plus, Trash2 } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { functions, type TargetProfileInput } from "./convex";
import { emptyDiscoveryProfile, importLocalProfile } from "./profileImport";

const lines = (value: string) => value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
const listText = (values: string[]) => values.join("\n");
const optionalNumber = (value: string) => value.trim() === "" ? undefined : Number(value);

export function DiscoverySettings() {
  const saved = useQuery(functions.getTargetProfile, {});
  const runs = useQuery(functions.listDiscoveryScanRuns, {});
  const saveProfile = useMutation(functions.saveTargetProfile);
  const requestScan = useMutation(functions.requestDiscoveryScan);
  const [draft, setDraft] = useState<TargetProfileInput>(emptyDiscoveryProfile);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<"save" | "scan" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (saved) {
      const { profileVersion: _profileVersion, updatedAt: _updatedAt, lastScanAt: _lastScanAt, ...fields } = saved;
      setDraft(fields);
      setDirty(false);
    }
  }, [saved?.profileVersion]);

  function change(next: Partial<TargetProfileInput>) {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
    setError("");
    setNotice("");
  }

  function listField(key: "allowedRegions" | "preferredRegions" | "dreamRegions" | "dreamIndustries" | "excludedCompanies" | "excludedIndustries" | "frameworks" | "cloudPlatforms" | "workAuthorization" | "clearanceLevels", label: string) {
    return <label key={key}>{label}<textarea onChange={(event) => change({ [key]: lines(event.target.value) })} rows={2} value={listText(draft[key])} /></label>;
  }

  function roleChange(index: number, update: Partial<TargetProfileInput["targetRoles"][number]>) {
    change({ targetRoles: draft.targetRoles.map((role, roleIndex) => roleIndex === index ? { ...role, ...update } : role) });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error("Target Profile file is too large.");
      change(importLocalProfile(await file.text()));
      setNotice("Profile loaded. Review it, enable discovery if wanted, then save.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that profile.");
    } finally { event.target.value = ""; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending("save");
    try {
      const version = await saveProfile({ profile: draft });
      setDirty(false);
      setNotice(`Target Profile v${version} saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the profile.");
    } finally { setPending(null); }
  }

  async function runNow() {
    setError("");
    setNotice("");
    setPending("scan");
    try {
      await requestScan({});
      setNotice("Scan queued. Results will appear in the review queue.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start discovery.");
    } finally { setPending(null); }
  }

  const latest = runs?.[0];
  return (
    <section aria-labelledby="discovery-settings-title" className="discovery-settings" id="discovery-settings">
      <header className="panel-header settings-heading">
        <div><p className="eyebrow">Search control</p><h2 id="discovery-settings-title">Target Profile</h2></div>
        <div className="settings-actions">
          <label className="button secondary import-control"><FileUp size={16} />Import saved profile<input accept=".yml,.yaml,text/yaml" aria-label="Import saved profile" onChange={(event) => void importFile(event)} type="file" /></label>
          <button className="button secondary" disabled={!saved?.enabled || dirty || pending !== null} onClick={() => void runNow()} type="button">{pending === "scan" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}Run now</button>
        </div>
      </header>
      <p className="settings-description">Start with role titles and location. Discovery checks a limited catalog of public employer feeds; it does not search every job board or verify professional licenses. You can also add a posting from any employer directly to your pipeline. Scans run only after you enable discovery and save.</p>
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <fieldset>
          <legend>Roles</legend>
          {draft.targetRoles.map((role, index) => <div className="target-role-row" key={index}>
            <label>Target role<input onChange={(event) => roleChange(index, { title: event.target.value })} required value={role.title} /></label>
            <label>Aliases, one per line<textarea onChange={(event) => roleChange(index, { aliases: lines(event.target.value) })} rows={2} value={listText(role.aliases)} /></label>
            <label>Seniority, one per line<textarea onChange={(event) => roleChange(index, { seniority: lines(event.target.value) })} rows={2} value={listText(role.seniority)} /></label>
            <button aria-label={`Remove ${role.title || "target role"}`} className="icon-button" disabled={draft.targetRoles.length === 1} onClick={() => change({ targetRoles: draft.targetRoles.filter((_, roleIndex) => roleIndex !== index) })} title="Remove role" type="button"><Trash2 size={16} /></button>
          </div>)}
          <button className="button secondary" onClick={() => change({ targetRoles: [...draft.targetRoles, { title: "", aliases: [], seniority: [] }] })} type="button"><Plus size={16} />Add target role</button>
        </fieldset>

        <fieldset>
          <legend>Location and work</legend>
          <div className="settings-grid">
            <label>Home location<input onChange={(event) => change({ home: event.target.value })} value={draft.home} /></label>
            <label>Local radius (miles)<input min="0" onChange={(event) => change({ radiusMiles: optionalNumber(event.target.value) })} type="number" value={draft.radiusMiles ?? ""} /></label>
            {listField("allowedRegions", "Allowed regions, one per line")}
            {listField("preferredRegions", "Preferred locations")}
            {listField("dreamRegions", "Dream locations")}
            {listField("dreamIndustries", "Dream industries")}
          </div>
          <div className="settings-checks" role="group" aria-label="Workplace modes">{(["remote", "hybrid", "onsite"] as const).map((mode) => <label key={mode}><input checked={draft.workplaceModes.includes(mode)} onChange={(event) => change({ workplaceModes: event.target.checked ? [...draft.workplaceModes, mode] : draft.workplaceModes.filter((value) => value !== mode) })} type="checkbox" />{mode[0].toUpperCase() + mode.slice(1)}</label>)}</div>
        </fieldset>

        <details className="settings-advanced"><summary>Optional preferences and eligibility</summary>
        <fieldset>
          <legend>Compensation and eligibility</legend>
          <div className="settings-grid">
            <label>Minimum annual salary<input min="0" onChange={(event) => change({ salaryFloor: optionalNumber(event.target.value) })} type="number" value={draft.salaryFloor ?? ""} /></label>
            <label>Currency<input maxLength={3} onChange={(event) => change({ currency: event.target.value.toUpperCase() })} value={draft.currency} /></label>
            {listField("workAuthorization", "Work authorization")}
            {listField("clearanceLevels", "Held clearance levels")}
            <label>Maximum travel (%)<input max="100" min="0" onChange={(event) => change({ maxTravelPercent: optionalNumber(event.target.value) })} type="number" value={draft.maxTravelPercent ?? ""} /></label>
            <label>Maximum office days per week<input max="7" min="0" onChange={(event) => change({ maxOfficeDaysPerWeek: optionalNumber(event.target.value) })} type="number" value={draft.maxOfficeDaysPerWeek ?? ""} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Focus and exclusions</legend>
          <div className="settings-grid">{listField("frameworks", "Tools, methods or frameworks")}{listField("cloudPlatforms", "Cloud platforms (optional)")}{listField("excludedCompanies", "Excluded companies")}{listField("excludedIndustries", "Excluded industries")}</div>
        </fieldset>
        </details>

        <fieldset>
          <legend>Discovery</legend>
          <div className="settings-grid">
            <label>Schedule<select onChange={(event) => change({ schedule: event.target.value as TargetProfileInput["schedule"] })} value={draft.schedule}><option value="manual">Manual</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option></select></label>
            <label className="settings-toggle"><input checked={draft.enabled} onChange={(event) => change({ enabled: event.target.checked })} type="checkbox" />Enable discovery</label>
          </div>
          <div className="settings-checks" role="group" aria-label="Job sources">{(["greenhouse", "ashby"] as const).map((source) => <label key={source}><input checked={draft.sources.includes(source)} onChange={(event) => change({ sources: event.target.checked ? [...draft.sources, source] : draft.sources.filter((value) => value !== source) })} type="checkbox" />{source === "ashby" ? "Ashby" : "Greenhouse"}</label>)}</div>
        </fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="access-notice" role="status">{notice}</p> : null}
        <div className="settings-footer"><span>{saved ? `Saved version ${saved.profileVersion}` : "No web profile saved"}{latest ? ` · Last scan: ${latest.status}, ${latest.reviewable} to review` : ""}</span><button className="button primary" disabled={saved === undefined || pending !== null || !dirty && !!saved} type="submit">{pending === "save" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Save Target Profile</button></div>
      </form>
      {latest?.status === "succeeded" && latest.reviewable === 0 && <p className="settings-description" role="status">This scan found no new reviewable matches in the selected feeds. Try another target title or location, or add a job directly. No matches here does not mean there are no suitable jobs elsewhere.</p>}
      {runs && runs.length > 0 ? <div className="scan-history"><h3>Recent scans</h3><div className="table-wrap"><table><thead><tr><th>When</th><th>Status</th><th>Feeds</th><th>New</th><th>For review</th><th>Rejected</th></tr></thead><tbody>{runs.slice(0, 5).map((run) => <tr key={run._id}><td>{new Date(run.queuedAt).toLocaleString()}</td><td>{run.status}{run.errorCode ? ` · ${run.errorCode.replaceAll("_", " ").toLowerCase()}` : ""}</td><td>{run.feedsSucceeded} ok{run.feedsFailed ? `, ${run.feedsFailed} failed` : ""}</td><td>{run.discovered}</td><td>{run.reviewable}</td><td>{run.rejected}</td></tr>)}</tbody></table></div></div> : null}
    </section>
  );
}
