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
