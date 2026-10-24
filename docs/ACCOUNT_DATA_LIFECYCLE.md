---
type: reference
title: Account export and deletion after hosted generation
created: 2026-10-24
tags:
  - privacy
  - convex
  - hosted-generation
related:
  - '[[PRIVACY]]'
  - '[[SECURITY]]'
  - '[[RESUME_STUDIO]]'
---

# Application data lifecycle

The authenticated `account.exportData` query produces
`jobbie-account-export-v5`. It requires the existing verified-user mapping,
including after enrollment is revoked. It accepts no owner identifier. Ownership,
auth identifiers and internal creation timestamps are removed; record IDs and
necessary career-record relationships remain for interpreting the export.

The shared `ownedAccountData` inventory in `web/convex/accountLifecycle.ts`
feeds export and account deletion. New owned tables must be added there and
to this inventory. Export return validators derive from the actual schema.

## Schema-to-export/deletion inventory

| Table/category | Self-service application export | Account deletion / retained purpose |
| --- | --- | --- |
| `users` | App profile and privacy acknowledgement; excludes `authId` | Delete mapping immediately; no app profile retained. The component profile is separate below. |
| `jobs` | Complete pipeline entries, including notes/posting snapshots | Delete in bounded batches. |
| `resumeBundles` | All saved source/posting/draft text, revisions and review state | Delete in bounded batches. Existing save cap stays 50. |
| `targetProfiles` | Full saved target settings | Delete. |
| `discoveryScanRuns` | All retained scan metadata, including queued/running entries | Delete. Existing retention stays 30. |
| `discoveredJobs` | Full private discovery projection/public posting snapshot | Delete. |
| `discoveryMatchDecisions` | Nested by job, plus standalone history with job IDs | Delete, including orphaned legacy history. |
| `discoveryReviewerOverrides` | Nested and standalone history, including reviewer reasons | Delete, including orphaned legacy history. |
| `discoveryStatusHistory` | Nested and standalone history | Delete, including orphaned legacy history. |
| `hostedResumeRequests` | Role/provider/model, consent, revision, status/failure and timestamps | Delete, including pending intents and company/title snapshots. No source or draft text is stored in these rows. |
| `aiPilotOwners` | Pilot status and any active-attempt reference | Delete enrollment and decrement pilot count once, even if a charge is unresolved. Global liability/lock survives separately. |
| `aiOwnerMonths` | Calendar-month attempt counts | Delete; re-enrollment on the same live owner still cannot reset quotas. |
| `aiBudgetAttempts` | Owner's pricing snapshot, billable bound, reservation/state/usage metadata | Remove owner ID. Retain opaque attempt/request IDs and billing fields for idempotency, unresolved charges and original-month reconciliation. No role, resume, posting, auth ID or email remains. |
| `aiBudgetControl` | Not personal: global operator controls/locks | Retain shared cutoff, totals and active liability lock; not an account record. |
| `aiBudgetPrices` | Not personal: approved operator configuration; attempt snapshot is exported | Retain price configuration. |
| `aiBudgetMonths` | Not personal: aggregate global settled/reserved totals | Retain aggregate accounting so deletion cannot reset the shared budget. |
| `alphaInvites` | Claimed invite ID and issuance/claim/expiry times only | Expire and unlink claimant/reservation fields. Keep digest/claim timing to prevent invite reuse and support enrollment investigation; never export token digests or reservation hashes. |
| `enrollmentAuditEvents` | Events associated with the claimed invite, bounded and digest-free | Retain event/invite/timestamp metadata after claimant unlinking; no user ID, email, IP or career text. |
| `accountPrivacyEvents` | Owner's export/deletion-request audit metadata | Delete owner-linked history; append a deletion action/time without a user ID. |
| `authAbuseLimits` | Security rate limits, outside the application-data download | HMAC address keys/counters remain for abuse prevention; deleting an account must not reset signup/recovery rate limits. No raw email or career text. Existing limiter enforces one-hour windows; physical expiry is not currently automated. |
| `errorReports` | Not personal: metadata without account identity | Retain minimized route/category/version/time diagnostics; no account, resume or request text. |
| Better Auth component user/account/session/verification data | Outside the app-data JSON. Any private auth/profile access request requires the supported operator process, excluding reusable secrets/hashes/tokens. | Use Better Auth's supported `deleteUser` flow. Installed 1.6.15 internal adapter deletes sessions and credential accounts before the user, then invokes the app trigger. Do not directly delete component tables. Outstanding verification/recovery records are component-managed and expiry-bound; this change does not certify their immediate physical removal. |
| Scheduled functions, service logs/backups, email and inference providers | Outside the application-table export | Queued functions carry opaque IDs, not resume text. Deletion cannot recall an already dispatched provider request, erase delivered mail, or purge platform logs/backups. Release operations/policies must document their retention and supported private requests. |

Billing and anonymous operational records are retained for reconciliation,
duplicate-charge prevention, budget integrity, invite-reuse prevention and
incident investigation. No automatic billing/audit age-out is introduced here.
A timed retention/backup policy and approved operator recovery process remain
release-preparation requirements; source deletion is not a claim of physical
erasure from external systems. Never discard unresolved billing to satisfy a
retention timer.

## Explicit single-response export limits

| Category | Maximum returned without an error |
| --- | ---: |
| Pipeline jobs / discovered jobs | 200 each |
| Match decisions / reviewer overrides / status history | 1,000 each |
| Target Profile / pilot enrollment / claimed invite | 1 each |
| Saved resume bundles | 50 |
| Retained scan runs | 30 |
| Hosted request history / billing attempt history | 500 each |
| Owner usage months | 120 |
| Privacy events / claimed-invite audit events | 1,000 each |

Every category probes one extra row and rejects the entire query on overflow;
there is no partial JSON marked complete. Orphaned discovery histories are also
exported independently so a missing parent cannot hide records. Platform byte
limits can additionally reject unusually large exports. A failed export needs
a complete private operator export with bounded reads; that operator workflow
is not implemented by this change. These export guards do not impose new save
caps on jobs/history. Do not describe the self-service JSON as a complete auth,
provider, backup or platform-log export.

## Deletion and callback ordering

Account deletion removes the application user mapping in the first transaction.
Each category drains up to ten rows per transaction; internal scheduled
continuations repeat until empty, without a cursor that could skip newly
encountered rows. A live owner cannot be passed to the continuation. This handles
legacy records above the normal bundle/scan caps. Larger cleanups complete
asynchronously; scheduler failure requires operator attention. Ordinary account
and role mutations cannot address the removed mapping/record during that drain.

Job deletion removes its bundle and all associated hosted requests. Bundle-only
deletion targets its exact bundle ID, so a new bundle for the same job cannot be
removed by an old continuation. Both reuse the existing verified-owner checks.
Continuations accept no public/browser calls.

Removing a never-dispatched request settles its reservation at zero, retaining
the consumed attempt. A dispatched or unknown attempt keeps its reservation and
global lock. Late worker settlement uses the existing attempt ID even after its
owner is detached; it updates only accounting. Completion only patches an
existing pending request and exact existing owner/job/bundle/revision after
consent/privacy/enrollment rechecks. It never inserts career data. Missing
requests and terminal deliveries are no-ops. Old scheduled workers therefore
cannot recreate deleted accounts, roles, bundles or request metadata. Discovery
workers likewise require an existing active run, current profile, enrollment
and privacy acknowledgement before ingesting career records.

## Verification boundary

The implementation task adds focused export-overflow and bounded-cleanup/ledger
regressions and preserves the existing authenticated tests. The following
playbook task separately exercises the full two-owner lifecycle, supported auth
route/session cleanup and late provider completion. No production deployment,
real account deletion or live inference is part of these source checks.

Schema compatibility: the new request/owner indexes are additive, while billing
`ownerId` and privacy-event `userId` become optional without a backfill. Once
anonymous records exist, rolling back to a schema that requires those fields is
incompatible. A release rollback must preserve the optional fields and accounting
logic; never reattach a deleted identity merely to satisfy an older schema.
