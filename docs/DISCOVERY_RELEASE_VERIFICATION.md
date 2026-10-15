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
The source header check currently validates a report-only CSP; the live release
smoke test requires an enforced CSP. Resolve that release-gate mismatch and
verify the local bridge behavior before enforcing the policy in production.
