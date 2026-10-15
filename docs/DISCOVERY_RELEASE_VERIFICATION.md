---
type: report
title: Discovery Release Verification
created: 2026-10-14
tags:
  - discovery
  - verification
  - release
related:
  - '[[RESUME_STUDIO]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[PRIVACY]]'
---

# Discovery release verification

The release candidate adds a saved web Target Profile, local YAML import,
manual and scheduled approved-public-feed discovery, owner-scoped scan history,
and filtered review queues. Account export and deletion include the profile and
scan records. Local discovery also reuses the existing scanner parsers and
matching/store components through an approved feed adapter.

## Worker corrections

Claiming a run and validating its profile now happen in one transaction.
Duplicate worker invocations return without failing an active run or replacing
its counters. Edited or disabled profiles stop queued work. Enrollment and
privacy acknowledgement are revalidated at claim and ingestion time; revoked
access prevents further result writes. Worker calls use generated typed
function references so invalid argument shapes fail TypeScript checking.

Regression tests exercise duplicate workers before and after completion,
profile changes after queueing, enrollment revocation, and obsolete privacy
acknowledgements. These use synthetic accounts in convex-test and do not read
production records or submit applications.

## Verified locally

- All 45 agent tests pass.
- All 25 Convex tests pass, including four new worker safety cases.
- All eight resume document/tailoring tests and eight local runner/bridge tests pass.
- TypeScript and the Vite application build pass.
- The seven-check security regression passes under Node 24.19.0: production
  dependency audit, authorization, build guard, guarded bundle build,
  endpoint verification, configured headers, and isolated browser workflow.
- The isolated browser workflow covers Target Profile YAML import, save and
  scan requests, discovery review to pipeline approval, and Resume Studio
  exports. Account persistence and scan results are mocked in this flow.

## Remaining release work

No Convex or Netlify production deployment was performed by this verification.
The guarded build used a synthetic endpoint, so its dist output must not be
published. Follow [[RELEASE_RUNBOOK]] to build against the intended deployment.
Real hosted sign-in, actual feed discovery, account persistence, and the full
real-user discovery-to-export path still require verification. Local GLM
browser generation was verified separately in [[RESUME_STUDIO]].

The worker currently scans a fixed public source catalog, retains at most 15
reviewable jobs per feed, and checks at most 50 enabled profiles per cron run.
This is an alpha capacity boundary, not a scalable discovery service. Work
authorization remains unknown rather than inferred, so results need review.
The report-only/enforced CSP mismatch was resolved in the release candidate;
see the verification below. The hosted deployment still needs to be updated.

## Enforced CSP release gate (2026-10-14)

`netlify.toml` now sends an enforced Content-Security-Policy, matching the live
release smoke gate. Resume Studio uses stylesheet classes for its fieldset,
command, file input, and changed-line layout instead of inline style attributes.
The policy permits only the configured Convex deployment and optional
Cloudflare Turnstile integration. No loopback permission was added: the GLM
runner is development-only, and the compiled hosted app keeps the existing
brief-download and draft-import workflow.

`npm run test:browser-csp` compiles the existing isolated account fixture into a
disposable directory under ignored `agent/.local/`, then serves those assets
with the actual policy from `netlify.toml`. It covers enrollment/privacy screens,
Target Profile import/save/scan, discovery review and pipeline approval, saved
resume bundles, text/Word exports, print layout, sign-out/sign-in, and mobile
sizing. It asserts zero CSP violations throughout that flow, then proves an
unapproved connection is blocked before reaching the network. It also confirms
local generation controls are absent from the compiled hosted interface.
Account persistence, job results, and Turnstile responses remain mocked; this
does not establish real hosted sign-in or discovery.

The nine-check security regression now includes this compiled browser check
and the release-smoke regression tests. It passed under Node 24.19.0, including
the guarded TypeScript/Vite build. Eight local runner/bridge tests and eight
resume tests also passed. The live smoke command runs both the development
workflow and compiled CSP workflow after checking the hosted release.

Read-only inspection of `https://dmd-career-ops.netlify.app/` returned HTTP 200,
but the response lacked CSP and the other configured security headers and used
an older cache policy. It is reachable but does not pass the release gate.
No deployment was performed. The security gate builds `web/dist` with a
synthetic Convex URL; do not publish that output. Rebuild for the intended
production deployment using [[RELEASE_RUNBOOK]] before publishing.


## Release CI and live-policy verification (2026-10-14, iteration 5)

Fixed the `Web Release Safety` PR workflow: its prior guarded build had no
`VITE_TURNSTILE_SITE_KEY`, which the guard requires. The workflow now installs
Chromium with its Linux dependencies and runs the existing nine-check security
regression, which supplies synthetic deployment URLs and a public Turnstile
fixture key without requiring provider credentials. This also brings account,
authorization, and compiled-CSP browser checks into PR verification.

The live smoke test now compares the hosted CSP against the actual reviewed
policy in `netlify.toml`, using the same policy reader as the compiled browser
fixture. Equivalent whitespace and directive/source order pass; missing or
extra permissions, stale backend origins, inline-script permissions, and
duplicate directives fail. The configured policy must explicitly allow the
expected production deployment's HTTPS, WebSocket, and HTTP-action origins.
Previously any nonempty enforced policy could pass, even if it blocked the app.

Verification passed under Node 24.19.0: all nine security regression checks,
including 25 backend tests, guarded TypeScript/Vite build, both isolated browser
flows, and five smoke regression tests. The source secret-pattern scan and
`git diff --check` also passed. These checks use fictional accounts and do not
prove real production sign-in or discovery.

Read-only Netlify status confirms the linked site is `dmd-career-ops` at
`https://dmd-career-ops.netlify.app`, using the repository's root `netlify.toml`.
A fresh live smoke probe failed at the entry-document cache policy:
`public,max-age=0,must-revalidate` instead of the required
`no-cache, no-store, must-revalidate`. No deployment was attempted. Local Convex
configuration selects `dev:third-wolverine-369`; no `CONVEX_DEPLOY_KEY` is present
in the shell. This does not establish whether Netlify's secret store is set up.

Next prepare the concrete production release for `beaming-bass-637` and the
linked Netlify site using [[RELEASE_RUNBOOK]], verify the provider environment
and budget settings, and then perform real-account discovery-to-export checks.
Production deployment consent is still required by the deployment guard; this
iteration did not deploy or change production data. The security suite replaced
`web/dist` with its synthetic-endpoint bundle: never publish that output.
GLM generation remains available through the verified local development bridge.

## Preserve release assets during verification (2026-10-14, iteration 6)

The full security regression no longer overwrites `web/dist` with its synthetic
backend. The existing production build guard accepts `--out-dir <directory>`
for both build and verification. The suite uses a unique ignored directory
under `agent/.local/` and removes it in a finally block, including when checks
fail. Normal production commands continue to use `web/dist` by default.

All nine security checks passed under Node 24.19.0, including the guarded
TypeScript/Vite build and both browser workflows. A SHA-256 manifest comparison
before and after the complete suite confirmed all five existing dist files
were unchanged. The seven build-guard tests now include missing/mixed/stale
bundle rejection and CLI selection of the isolated directory. The source
secret-pattern scan and `git diff --check` passed. The temporary suite build
directory was removed after the run.

This preserves existing assets; it does not certify them for publication.
The current `web/dist` still contains the prior iteration's synthetic endpoint
and must be rebuilt for the intended production deployment. No provider
configuration, production deployment, or real-account discovery was performed.
Continue with the production preconditions in [[RELEASE_RUNBOOK]]; hosted
sign-in and real discovery-to-resume-export verification remain outstanding.

## Executable release preflight (2026-10-14, iteration 7)

Added `web/scripts/release-preflight.mjs`, available as `npm run release:preflight`.
An explicit production endpoint is required. The command reports all missing
inputs together: Node 24, CSP compatibility, process build settings, the known
local development URL denylist, optional endpoint overrides, and existing dist
endpoints. `--check-convex-env` adds a read-only provider audit using
`convex env list --names-only --deployment <explicit-name>`. Provider output,
secret values, and exception messages are never printed. Seven regression
tests cover configuration failures, provider targeting, and output redaction;
these now run in the full security gate.

Fresh production reads for `beaming-bass-637` returned only `JWKS`,
`JWT_PRIVATE_KEY`, and `SITE_URL`. Better Auth, Turnstile, Resend, abuse-key,
enrollment-key, and backend release-version settings are missing.
`convex deployment usage-limits list --json --deployment beaming-bass-637`
returned an empty array. No limits were configured by this iteration.
The current local process also lacks the required build inputs; this does not
prove whether those inputs exist in Netlify's production secret store.
The existing dist still fails the intended-production endpoint check.

All ten security-regression checks passed under Node 24.19.0, including seven
new preflight tests, authorization, TypeScript/Vite build, and both compiled
browser flows. The production preflight deliberately exited nonzero for the
confirmed blockers. Source secret scanning and `git diff --check` passed.
No production configuration or deployment was changed, and no real-account
journey was attempted. See [[RELEASE_RUNBOOK]] for remaining provider value/scope,
budget/notification, deployment, and hosted discovery-to-export checks.
