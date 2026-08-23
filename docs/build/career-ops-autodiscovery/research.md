# Career Ops Autonomous Discovery Research

## Purpose and scope

Build a single-user, local-first Cyber/GRC/cloud job-search agent for Dee. It
must discover jobs from configured sources, filter and rank them against one
persisted Target Profile, and maintain a private review pipeline. It must never
submit an application or expose browser credentials to the web application.

This document records the repository baseline inspected on 2026-08-22. It is a
design record, not an implementation claim.

## Current-state code map

| Area | Current files | Existing behavior |
| --- | --- | --- |
| Personal configuration | `config/profile.yml`, `modes/_profile.md`, `cv.md`, `article-digest.md` | Local, ignored user-layer career data. `config/profile.yml` contains candidate identity and targets but is not a structured discovery profile. |
| Portal configuration | `portals.yml`, `templates/portals.example.yml` | Local, ignored company watchlist, search queries, title filters, and location filters. The active file targets security architecture roles and 12 companies. |
| API discovery | `scan.mjs` | Fetches public Greenhouse, Ashby, and Lever feeds concurrently; normalizes title, URL, company, and location; applies title/location filters; deduplicates against local markdown/TSV sources; writes `data/pipeline.md` and `data/scan-history.tsv`. Supports `--dry-run` and `--company`; no scheduler, job description capture, structured persistence, or explainable matching. |
| Agent-assisted discovery specification | `modes/scan.md` | Describes Playwright/WebSearch collection, liveness checks, and public ATS providers. It is guidance for an AI session, not a reliable executable worker. |
| Evaluation and report flow | `modes/auto-pipeline.md`, `modes/oferta.md`, `modes/pdf.md`, `generate-pdf.mjs`, `verify-pipeline.mjs` | A pasted URL/JD is extracted, evaluated A-F plus legitimacy, scored, reported to `reports/`, and may produce an ATS PDF. Application answers are drafts only. |
| Batch execution | `batch/batch-runner.sh`, `batch/batch-prompt.md`, `batch/README.md` | Launches separate `claude -p` workers for explicitly supplied offers. Has TSV state, retries, locking, resume, report/PDF generation, and tracker merging. It is not driven by the scanner or browser. |
| Canonical local pipeline | `data/pipeline.md`, `data/applications.md`, `data/scan-history.tsv`, `merge-tracker.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs` | Markdown and TSV files are the current local pipeline. They are user-layer files and must stay ignored. |
| Local dashboard | `dashboard/` | Go TUI showing local pipeline data, scores, statuses, and reports. |
| Web frontend | `web/src/App.tsx`, `web/src/convex.ts` | React/Vite interface with sign-in, private role pipeline, manual role creation, status update, export, and account deletion. It has no Target Profile, discovery view, scheduler, evaluator integration, or materials UI. |
| Web backend | `web/convex/schema.ts`, `web/convex/jobs.ts`, `web/convex/auth.ts`, `web/convex/privacy.ts`, `web/convex/account.ts` | Convex plus Better Auth. Jobs are owner-scoped and require an enrolled verified user. Current `jobs` fields are company, title, location, URL, source, notes, status, score, and timestamps. |
| Security/privacy | `DATA_CONTRACT.md`, `.gitignore`, `docs/SECURITY.md`, `docs/PRIVACY.md`, `docs/INCIDENT_RESPONSE.md` | Personal career records, secrets, and browser profiles are local/ignored. Hosted alpha is invite-only and explicitly does not scan boards, collect credentials, generate/upload resumes, or submit applications. |
| Tests and release checks | `doctor.mjs`, `test-all.mjs`, `web/convex/auth.test.ts`, `web/scripts/isolated-browser-flow.mjs`, `web/scripts/security-regression.mjs`, `docs/RELEASE_RUNBOOK.md` | Local readiness, pipeline verification, web auth tests, mocked isolated browser UI flow, security checks, production-build guard, and header tests exist. No discovery/matching integration test suite exists. |

## Gaps against the required workflow

1. No persisted, structured Target Profile exists. `portals.yml` is scanner
   configuration and `config/profile.yml` is narrative candidate configuration;
   neither can express all required hard constraints and matching evidence.
2. Scanner output is file-only. It cannot populate the React/Convex pipeline,
   record source/run health, retain normalized descriptions, or explain why a
   role was rejected.
3. Browser-assisted discovery is prompt guidance only. There is no Interceptor
   adapter, dedicated browser context, source allowlist, run lease, or retry
   state.
4. Matching is title and location string filtering. It lacks compensation,
   work authorization, clearance, industry, company, cloud stack, framework,
   must-have, and deal-breaker rules.
5. The web `jobs` table is a manual application tracker, not a discovery,
   matching, or materials workflow. It lacks candidate evidence references,
   source metadata, lifecycle history, and scan records.
6. Existing evaluation is powerful but is only started by a user/CLI action.
   The batch runner must remain downstream of an explicit review decision, not
   a browser event.
7. No durable scheduler or local worker is present. There is no safe boundary
   between a browser automation context and the AI CLI.
8. The web alpha has deployment/authentication migration work still pending;
   production signup must not become a dependency for Dee's local-first MVP.

## Recommended architecture

### Design decision: local canonical state, optional private projection

The local agent directory is canonical for the Target Profile, raw discovery
records, normalized job descriptions, resume/profile references, match
decisions, scan runs, and generated material references. Convex is an optional
private projection for the existing review UI after a local worker pairs to
Dee's account. This avoids making job discovery dependent on a hosted service
and keeps browser capabilities and career data off the public frontend.

Use a new local agent package (proposed `agent/`) with an explicit file-backed
MVP store under an ignored `data/autodiscovery/` directory. Do not put career
content in Git, test fixtures, workflow logs, or browser telemetry. SQLite can
replace JSON/NDJSON once query volume and migrations justify it; start with
versioned JSON schemas plus append-only run events to minimize dependencies.

### Components

```text
Target Profile editor (web or local UI)
        |
        | loopback pairing / explicit save
        v
Local agent store <----> existing config/profile.yml and portals.yml migration
        |
        +--> public ATS collector (existing scan.mjs adapter)
        |
        +--> Interceptor collector (dedicated browser context, allowlisted sites)
        |
        v
normalize -> deduplicate -> hard-filter -> explainable match decision
        |
        +--> local review queue / optional Convex projection
        |
        +--> explicit user action only
               |
               v
        evaluation/materials worker -> existing modes + batch/report flow
```

The collector never invokes `claude`, `codex`, or the batch runner. It only
produces validated discovery records. A separate evaluation worker consumes a
user-selected `review-ready` job ID; it receives a job description snapshot and
local profile references, not browser control. The application checklist has no
submit action or employer-form mutation capability.

### Target Profile data model

Store one versioned `TargetProfile` per local installation and include a
non-secret `profileVersion` on every scan and match decision.

```text
TargetProfile
  id, schemaVersion, updatedAt
  targetRoles[]: { title, aliases[], priority, seniority[] }
  location: { home, radiusMiles?, modes[], allowedRegions[], excludedRegions[] }
  compensation: { floor?, target?, currency, basis, disclosePreference? }
  eligibility: { workAuthorization[], clearance: { required?, levels[] } }
  preferences: { industries[], excludedIndustries[], companies[], excludedCompanies[] }
  expertise: { frameworks[], cloudPlatforms[], tools[], skills[] }
  criteria: { mustHave[], dealBreakers[], notes? }
  evidenceReferences[]: { kind, localPath, label, updatedAt }
  discovery: { sources[], schedule, maxPerRun, enabled }
```

`evidenceReferences` are paths and metadata only. Do not upload resume content
to Convex merely to calculate a match.

### Discovery and pipeline data model

```text
DiscoveredJob
  id, canonicalUrl, externalIds{}, source, sourceJobUrl
  company, title, location, workplaceType, employmentType
  compensation?, postedAt?, discoveredAt, descriptionPath?, descriptionHash
  rawCapturePath?, normalizedAt, lifecycle: active|expired|unknown

ScanRun
  id, profileVersion, trigger: manual|scheduled, collector: ats-api|interceptor
  sourceId, startedAt, finishedAt, status: succeeded|partial|failed|blocked
  counts: discovered|normalized|duplicate|rejected|shortlisted
  retryCount, nextRetryAt?, errorCode?, safeErrorDetail?

MatchDecision
  id, jobId, profileVersion, decidedAt
  outcome: rejected|ranked|needs-review
  hardFilterResults[]: { ruleId, outcome, reasonCode }
  score: 0..100, subscores: role|seniority|location|compensation|eligibility|expertise
  evidenceMatches[]: { criterion, evidenceReference, confidence }
  explanations[], reviewerOverride?

PipelineItem
  jobId, status: discovered|shortlisted|reviewing|approved-for-evaluation|
                 evaluated|ready-to-apply|applied|interview|offer|rejected|archived
  nextAction, ownerApprovalAt?, statusHistory[]

MaterialBundle
  jobId, evaluationRequestedAt, reportPath?, resumePath?, checklistPath?
  sourceProfileVersion, generatedAt?, reviewState
```

Use canonical URL first, then normalized company/title/location plus external
ATS identifiers to deduplicate. Keep a hash of normalized description content
to detect materially changed postings without logging raw descriptions.

## Interceptor browser collection strategy

1. Dee creates a dedicated `Jobbie Discovery` browser profile and installs
   Interceptor there. It must receive a unique Interceptor context ID and be
   separate from personal browsing profiles.
2. The local agent receives only that context ID and an explicit source
   allowlist from the Target Profile. It opens career-listing and job-detail
   pages in the Interceptor tab group.
3. The adapter reads accessible DOM/a11y content, follows ordinary pagination,
   captures listing/detail metadata, and emits a normalized candidate record.
   It does not read/export cookies, passwords, session storage, browser history,
   or credentials.
4. Authenticated source collection is opt-in per source. Dee logs in manually
   in the dedicated profile. A missing login, CAPTCHA, access denial, or stale
   context is a `blocked` scan result, never a bypass attempt.
5. Apply routes and submit controls are out of scope. The adapter must refuse
   selectors/URLs associated with job application submission. It can collect a
   listing and job description only.
6. The local worker communicates with Interceptor through its CLI. The hosted
   browser frontend never receives an Interceptor context ID, command output,
   browser storage, or a generic browser-control API.

## Security boundaries and risks

| Boundary/risk | Required control |
| --- | --- |
| Browser credentials | Dedicated profile/context, manual sign-in, no cookie/storage export, local-only Interceptor commands. |
| Browser to AI CLI escalation | Collector writes validated records only. Evaluation requires a separate explicit local command or reviewed queue action. No browser callback can launch an AI CLI. |
| Hosted frontend access | Convex remains owner-scoped. Pairing uses a short-lived, scoped, revocable local-worker token stored hashed server-side; no auth session or job-board credential is copied to the worker. |
| Career-data leakage | Keep raw JDs, notes, resume paths, capture files, reports, and Target Profile local/ignored. Send only minimum pipeline projection fields to Convex. |
| Source terms/CAPTCHAs | Use public APIs first; allow only user-authorized browser sources; no proxy rotation, bot evasion, CAPTCHA solving, or indiscriminate crawling. |
| Hallucinated materials | Material generator must cite local evidence references and label gaps. No unsupported claims or automatic form submission. |
| Bad recommendations | Hard filters precede ranking; preserve rejection codes, profile version, override reason, and source evidence for review. |
| Scheduler runaway | Per-source locks, max listing/detail caps, jitter, bounded retries, cooldown on blocked sources, and a visible kill switch. |
| Current repository divergence | The local product branch is substantially behind current fork `origin/main`; rebase/integration assessment is required before combining this work with the latest upstream changes. |

## Decisions and remaining inputs

The following implementation defaults were selected after inspecting Dee's
Ubuntu 24.04 VM: it has a running user-level `systemd`, Chrome, and
Interceptor. They remove all blockers to Phase 1.

1. **Canonical storage:** local VM storage is canonical. Convex may hold an
   optional owner-scoped projection of limited pipeline metadata for the review
   UI. Raw resumes, raw JDs, browser data, evidence files, and local paths stay
   on the VM.
2. **Scheduling environment:** the VM runs the local worker through a
   `systemd --user` service and timer. Manual runs ship first; scheduled runs
   are enabled only after the manual collector is verified.
3. **Initial sources:** use the existing public Greenhouse, Ashby, and Lever
   API adapters first. They need no job-board credentials and already cover the
   configured Cyber/GRC/cloud company watchlist. Interceptor is added later for
   explicitly authorized career sites that lack a usable public feed.
4. **Remaining profile inputs:** role/seniority, geography, compensation,
   eligibility/clearance, exclusions, frameworks, cloud stack, and evidence
   references are needed for useful matches, but they do not block building the
   profile UI/schema. They are collected through Phase 1 instead of being a
   prerequisite.

## Revised engineering estimate

**11-15 engineer-weeks** for a dependable local-first MVP, assuming one
supported desktop OS and 3-5 authorized discovery sources. This includes
implementation, tests, security/operational docs, and a controlled integration
with existing evaluator/report flow. It excludes production multi-user launch,
payments, mobile clients, broad job-board coverage, CAPTCHA bypassing, and
autonomous application submission.

The first useful slice is 1.5-2 weeks: persisted Target Profile plus a manual
dry-run matcher against existing ATS scan output. Browser collection and
scheduling should follow only after the profile/match contract is stable.
