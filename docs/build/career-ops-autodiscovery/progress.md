# Career Ops Autonomous Discovery Progress

## Status

**Program state:** Phase 7 release-gate dry run complete. The local-first MVP is
ready for human operational review; it remains deliberately manual for browser
authorization, evaluation approval, material review, and any application step.

**Goal:** a single-user, local-first Cyber/GRC/cloud job-search agent that
discovers and ranks roles for Dee, preserves a private pipeline, generates
reviewable materials, and never submits applications automatically.

## Baseline verified

- [x] Local ATS scanner exists in `scan.mjs` and supports public Greenhouse,
  Ashby, and Lever feeds plus title/location filtering and local deduplication.
- [x] `portals.yml` is a personalized, ignored watchlist with security
  architecture role filters, location policy, search queries, and 12 companies.
- [x] Existing evaluator/report/PDF flow is documented in
  `modes/auto-pipeline.md` and `docs/ARCHITECTURE.md`.
- [x] Batch processing has durable local TSV state, retry, locking, and resume
  behavior in `batch/batch-runner.sh`.
- [x] React/Convex web alpha has owner-scoped manual pipeline jobs, Better Auth,
  account export, and deletion controls.
- [x] Existing privacy/security documentation explicitly excludes job-board
  scanning, browser credentials, resume uploads, and autonomous submission from
  the hosted alpha.
- [x] Local Target Profile persistence, validation, monotonic versioning, and a
  loopback-only editor exist under `agent/`.
- [x] Local scheduler, dedicated-context Interceptor boundary, scan-run store,
  explainable matcher, and bounded local projection hand-off exist. None can
  submit an application or upload a projection by itself.

## Delivery checklist

- [x] Phase 0: integration baseline and local-agent boundary
- [x] Phase 1: Target Profile persistence and UI
- [x] Phase 2: explainable matching and rejection rules
- [x] Phase 3: browser collection, normalization, and deduplication
- [x] Phase 4: private pipeline and review UI
- [x] Phase 5: scheduled scan runs, retries, history, and daily shortlist
- [x] Phase 6: tailored materials and checklist integration
- [x] Phase 7: tests, hardening, and operations

## Decisions recorded

| Decision | Rationale | Status |
| --- | --- | --- |
| No autonomous application submission | Protects Dee's judgment, employer interactions, and product trust boundary. | Fixed |
| Local data is canonical | Browser access, raw JDs, resume references, and career evidence should not depend on hosted infrastructure. Convex may receive only limited owner-scoped pipeline metadata. | Fixed |
| Interceptor is local-only | Browser context, cookies, and credentials must never become frontend or Convex capabilities. | Fixed |
| Public ATS first | Prefer existing structured sources; use Interceptor only for Dee-authorized career sites. | Fixed |
| Evaluator remains downstream | Browser/discovery cannot directly launch AI CLI work. Dee approval queues evaluation. | Fixed |
| Manual scan before schedule | Establish source health and match quality before unattended runs. | Fixed |
| VM hosts the worker | Ubuntu 24.04 VM has Chrome, Interceptor, and a running user-level systemd; it can host the private worker and timer. | Fixed |
| Initial sources | Greenhouse, Ashby, and Lever public ATS feeds reuse existing scanner support and require no job-board credentials. | Fixed |

## Current constraints

- The implementation is isolated on `feat/autodiscovery-target-profile`, but
  the underlying local product history remains materially behind `origin/main`.
  Reconcile it before integrating with newer upstream code.
- Convex/Netlify Better Auth work has not completed a production migration;
  this local-first project must not depend on public signup for its first slice.
- Interceptor is installed but no dedicated isolated profile/context is currently
  attached for Career Ops collection.
- The existing scanner only returned zero new roles in its latest configured run;
  target criteria need no changes until the Target Profile and explanation model
  make tradeoffs visible.

## Controlled end-to-end dry run — 2026-08-23

- Completed a disposable, local Target Profile with fixture-only evidence; no
  personal profile, resume content, browser profile, or employer application
  was used.
- Simulated one public Greenhouse ATS record, normalized it with its job-detail
  snapshot held only in local private storage, and confirmed canonical-URL
  deduplication on the repeated record.
- Matched the normalized fixture to a ranked decision, then used a separate
  `approved-for-evaluation` record to enqueue it. The evaluator received
  `draftOnly: true` and `submissionAllowed: false`, and produced a draft report
  and manual checklist in `draft-awaiting-review` state.
- Generated the local daily shortlist plus an optional local projection. The
  projection contained only allowed review metadata; it omitted job-detail
  text, evidence references, local paths, and draft artifact paths. The
  controlled run's network guard recorded zero outbound calls, so no
  application submission route was called.
- Added `agent/test/controlled-dry-run.test.mjs` as the repeatable regression
  for this sequence. Node 24.18.0 `node test-all.mjs --quick` passed **112**
  checks with **0** failures and **14** pre-existing documentation warnings.

### Remaining operational limitations

- This was a fixture-backed Greenhouse dry run, not a live posting collection;
  validate configured public ATS sources when real target criteria produce a
  candidate.
- Interceptor remains opt-in and must use the dedicated `Jobbie Discovery`
  browser context with a narrow approved-source allowlist; it must never use a
  personal browser profile.
- A real evaluator adapter, human review of the draft bundle, and a deliberate
  manual application step are still required. The local projection is only a
  file hand-off and is not uploaded without a separate authenticated bridge.
- The release gate requires Node 24.18.0; the default shell currently selects
  Node 18 and must be changed before an operator runs the gate.

## Next shippable milestone

**Operational readiness review** is next: validate a real, authorized public
ATS source against the completed Target Profile, review the resulting material
bundle, and keep any application submission manual. See [[RELEASE_RUNBOOK]]
before enabling a recurring scheduler.

## Remaining user inputs

1. Validate the real Target Profile via `npm run profile -- edit`; do not use
   the disposable fixture profile from the dry run.
2. Create a dedicated `Jobbie Discovery` browser profile and manually sign in
   only to any future approved authenticated sources. Public ATS collection
   does not require a job-board login.

No user decision blocks the local release gate; the remaining actions are
deliberate operator review and authorized-source validation.
