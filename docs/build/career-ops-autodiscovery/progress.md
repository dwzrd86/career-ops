# Career Ops Autonomous Discovery Progress

## Status

**Program state:** Phase 1 complete; explainable matching is next.

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
- [x] No local scheduler, Interceptor collector, scan-run store, explainable
  matcher, or scanner-to-web ingestion exists.

## Delivery checklist

- [x] Phase 0: integration baseline and local-agent boundary
- [x] Phase 1: Target Profile persistence and UI
- [ ] Phase 2: explainable matching and rejection rules
- [ ] Phase 3: browser collection, normalization, and deduplication
- [ ] Phase 4: private pipeline and review UI
- [ ] Phase 5: scheduled scan runs, retries, history, and daily shortlist
- [ ] Phase 6: tailored materials and checklist integration
- [ ] Phase 7: tests, hardening, and operations

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

## Next shippable milestone

**Phase 2: explainable matching and rejection rules** is next. It will run the
saved Target Profile against existing ATS results and show deterministic reject,
review, or rank reasons. It does not require an authenticated job board,
scheduler, public deployment, or AI-driven evaluation.

Estimated effort: **1.5-2 engineer-weeks**. Total MVP estimate: **11-15
engineer-weeks** for one desktop OS and 3-5 authorized sources.

## Remaining user inputs

1. Complete the Target Profile using `npm run profile -- edit`. The local editor
   collects role, seniority, location, compensation, clearance/authorization,
   exclusions, expertise, and local evidence references.
2. Create a dedicated `Jobbie Discovery` browser profile and log into any
   authenticated sources manually before Phase 3. The first public ATS phase
   does not require a job-board login.

No user decision blocks Phase 2 implementation.
