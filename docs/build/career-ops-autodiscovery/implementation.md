# Career Ops Autonomous Discovery Implementation Plan

## Delivery rules

- Keep the system single-user, invite-only, and local-first.
- Never submit an application, click employer submit controls, or store browser
  credentials outside the dedicated local browser profile.
- Preserve `DATA_CONTRACT.md`: career data, profile data, reports, and captures
  are user-layer data and remain ignored by Git.
- Reuse `scan.mjs`, `modes/auto-pipeline.md`, `batch/batch-runner.sh`, and
  existing Convex owner checks where they fit. Do not replace them wholesale.
- Each phase is independently shippable and must not require production signup
  or a public launch.

## Phase 0: integration baseline

**Status:** Complete on 2026-08-23.

**Objective:** establish a clean integration branch from the current fork head,
protect local user data, and document the local-agent boundary before feature
work.

**Files:** `.gitignore`, `DATA_CONTRACT.md`, `docs/build/career-ops-autodiscovery/progress.md`, new `agent/README.md`.

**Acceptance criteria:**
- No personal data, browser profiles, captured JDs, or worker tokens can enter Git.
- `agent/` scope and local data directory are documented.
- Existing `npm run doctor`, `npm run scan -- --dry-run`, and web security tests still pass.

**User test:** run the dry scanner and confirm no personal data appears in
`git status`.

**Dependencies/risks:** resolve the current local-versus-`origin/main`
divergence first. This is a technical prerequisite, not a product rewrite.

## Phase 1: Target Profile persistence and UI

**Status:** Complete on 2026-08-23.

**Objective:** create one versioned Target Profile that drives all discovery
and match decisions.

**Files:** `config/target-profile.example.yml`, new
`agent/schemas/target-profile.schema.json`, `agent/store/target-profile.mjs`,
`agent/commands/profile.mjs`, `agent/ui/target-profile.html`,
`agent/test/target-profile.test.mjs`, `agent/test/target-profile-editor.test.mjs`,
`.gitignore`, `DATA_CONTRACT.md`, `package.json`, and `agent/README.md`.

**Acceptance criteria:**
- Fields cover roles/seniority, location/radius/workplace policy, compensation,
  authorization/clearance, industries/companies, frameworks, cloud stack,
  must-haves, deal-breakers, and local evidence references.
- Local store is canonical, versioned, validated, and ignored by Git.
- Loopback-only editor displays and saves the local canonical profile through a
  per-run capability token. It does not read resume contents or use Convex.
- Every save increments `profileVersion`; no scanner may run without a valid
  profile.

**User test:** fill the profile, save it, restart the local worker, reopen the
UI, and confirm values and version persist. Verify a malformed salary or
unsupported workplace mode is rejected with a useful message.

**Dependencies/risks:** no external dependency. An optional Convex review
projection belongs in Phase 4; do not add document upload in this phase.

## Phase 2: explainable matching and rejection rules

**Objective:** turn Target Profile criteria into deterministic hard-filter and
transparent ranking decisions.

**Files:** new `agent/matching/rules.mjs`, `agent/matching/score.mjs`,
`agent/schemas/discovered-job.schema.json`, `agent/schemas/match-decision.schema.json`,
`scan.mjs` adapter or new `agent/commands/match.mjs`, new fixtures under
`agent/test/fixtures/`, `web/convex/schema.ts`, `web/convex/jobs.ts`,
`web/src/App.tsx`, `web/src/convex.ts`.

**Acceptance criteria:**
- Hard filters evaluate location, workplace mode, salary floor when known,
  authorization, clearance, excluded company/industry, and deal-breakers.
- Ranking produces a 0-100 score with role, seniority, expertise, framework,
  cloud-stack, and preference subscores.
- Each reject/rank result records stable reason codes and profile version.
- Unknown information is reported as `unknown`, not guessed as a match.

**User test:** run fixture jobs through the matcher and inspect why one role is
rejected, one needs review, and one is shortlisted. Change a deal-breaker and
confirm the decision changes reproducibly.

**Dependencies/risks:** depends on Phase 1 schema. Avoid LLM-based scoring
until deterministic rules and fixtures are trusted.

## Phase 3: browser collection, normalization, and deduplication

**Objective:** make discovery autonomous for approved sources while preserving
the existing public ATS scanner.

**Files:** new `agent/collectors/ats-api.mjs`,
`agent/collectors/interceptor.mjs`, `agent/collectors/normalize.mjs`,
`agent/collectors/deduplicate.mjs`, `agent/commands/discover.mjs`,
`agent/store/discovered-jobs.mjs`, `agent/store/scan-runs.mjs`,
`agent/README.md`, `portals.yml` schema/docs, `docs/SCRIPTS.md`, tests under
`agent/test/`.

**Acceptance criteria:**
- Existing Greenhouse/Ashby/Lever API discovery is reused through an adapter.
- Interceptor accepts only the configured dedicated context and source allowlist.
- Browser collection reads listings/details only and never exports browser
  storage or invokes an AI CLI.
- Normalization yields canonical URL, source IDs, title, company, location,
  description snapshot path/hash, and lifecycle state.
- Deduplication covers canonical URL, ATS ID, and normalized company/title/
  location; every outcome is recorded in a scan run.

**User test:** enable one public ATS source and one dedicated-profile browser
source; run a manual scan; verify duplicate, blocked, expired, rejected, and
shortlisted outcomes in run history. Confirm no personal browser context is
addressed.

**Dependencies/risks:** requires an installed Interceptor CLI and a manually
configured dedicated profile. Respect source terms and stop on CAPTCHA or
access denial; do not add evasion behavior.

## Phase 4: private pipeline and review UI

**Objective:** give Dee a useful decision workspace for discovered jobs without
turning it into an autonomous application tool.

**Files:** `web/convex/schema.ts`, `web/convex/jobs.ts`, new
`web/convex/discovery.ts`, `web/convex/targetProfile.ts`,
`web/src/App.tsx`, `web/src/convex.ts`, `web/src/styles.css`,
`web/convex/account.ts`, browser-flow tests and security tests.

**Acceptance criteria:**
- Pipeline lists discovered jobs, match score, hard-filter reasons, source,
  freshness, and next action without exposing raw credentials or local paths.
- Dee can shortlist, archive, override a match with a reason, and explicitly
  mark one role `approved-for-evaluation`.
- Existing manual jobs remain readable and migrate safely to the new status
  vocabulary.
- Export/delete behavior includes new hosted projection fields only.

**User test:** review a shortlist, inspect the explanation, override one rank,
approve one job for evaluation, and verify another account cannot query it.

**Dependencies/risks:** depends on Phases 1-3 data contracts. Keep raw JD and
resume material local by default; projection payloads must be size-limited.

## Phase 5: scheduled scan runs, retries, history, and daily shortlist

**Objective:** run collection predictably on Dee's machine and surface only
actionable results.

**Files:** new `agent/daemon.mjs`, `agent/scheduler.mjs`,
`agent/store/run-queue.mjs`, `agent/commands/status.mjs`, OS-specific install
templates under `agent/scheduler/`, `docs/SETUP.md`, `docs/SCRIPTS.md`,
`docs/INCIDENT_RESPONSE.md`, `web/convex/discovery.ts`, `web/src/App.tsx`,
tests under `agent/test/`.

**Acceptance criteria:**
- Manual run remains available; scheduler has a visible enabled/disabled state.
- Per-source locks, jitter, bounded retries, cooldowns, max result caps, and a
  kill switch prevent runaway activity.
- Missing browser context/login/CAPTCHA produces `blocked`, not retry storms.
- Daily shortlist is derived from current `ranked` decisions and does not send
  job content to third parties.

**User test:** schedule a short test interval, force one source failure, verify
retry/backoff and history, then disable the scheduler and confirm no further
runs begin.

**Dependencies/risks:** requires Dee's supported OS/scheduler decision and an
available machine. Background browser collection cannot be guaranteed while the
dedicated browser profile is closed.

## Phase 6: tailored materials and checklist integration

**Objective:** connect reviewed jobs to the existing evaluator/report pipeline
without allowing discovery/browser events to launch it.

**Files:** new `agent/evaluation/queue.mjs`, `agent/evaluation/worker.mjs`,
`agent/templates/application-checklist.md`, `modes/auto-pipeline.md`,
`modes/oferta.md`, `batch/batch-runner.sh`, `verify-pipeline.mjs`,
`web/convex/discovery.ts`, `web/src/App.tsx`, tests under `agent/test/`.

**Acceptance criteria:**
- Only a Dee-approved pipeline item enters the evaluation queue.
- Worker passes a normalized JD snapshot and local evidence references to the
  established evaluator/report/PDF flow.
- Material bundle records source job and profile versions, paths, and review
  state; unsupported claims are flagged.
- Checklist contains manual application steps and no submission automation.

**User test:** approve one role, generate a report/resume/checklist, confirm
the report names evidence and gaps, then complete no more than a manual review
of the external application.

**Dependencies/risks:** depends on evaluator CLI availability and existing
local content. Treat generated materials as drafts requiring Dee's review.

## Phase 7: tests, hardening, and operations

**Objective:** make the MVP safe to run continuously and recoverable when a
source, browser, worker, or projection fails.

**Files:** `test-all.mjs`, `doctor.mjs`, new `agent/test/` suites,
`web/scripts/security-regression.mjs`, `docs/SECURITY.md`,
`docs/PRIVACY.md`, `docs/INCIDENT_RESPONSE.md`, `docs/RELEASE_RUNBOOK.md`,
`docs/SETUP.md`.

**Acceptance criteria:**
- Fixture tests cover normalization, deduplication, hard filters, score
explanations, profile-version consistency, scheduler retry/kill switch, and
collector refusal of unapproved contexts/apply routes.
- Integration test uses an isolated browser profile and disposable account only.
- Security regression confirms no browser tokens, local paths, raw JDs, resume
content, or application answers reach the frontend/error reporting.
- Documentation includes backup/export, token rotation, source failure, and
worker shutdown procedures.

**User test:** execute the documented local release checklist, simulate a lost
browser context and revoked pairing token, and confirm the system fails closed.

**Dependencies/risks:** relies on all earlier phases. Public release remains
out of scope; this gate targets Dee's private MVP only.
