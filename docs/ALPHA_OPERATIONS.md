---
type: reference
title: Meritwake Beta Operations
created: 2026-08-01
tags:
  - beta
  - operations
  - privacy
related:
  - '[[INCIDENT_RESPONSE]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[PRIVACY]]'
  - '[[SECURITY_CONTACT]]'
---

# Meritwake beta operations

This runbook operates the limited Meritwake beta without a hidden roster of user
email addresses. It covers normal readiness, enrollment, feedback, and the
self-service app controls and supported private account/auth data requests. For suspected security events,
use [[INCIDENT_RESPONSE]] immediately.

## Current beta scope and owners

Meritwake stores verified-account, pipeline, saved resume/draft, selected-role
generation and discovery data in the configured Convex deployment. It uses Resend for verification and recovery
mail, Cloudflare Turnstile for signup bot checks, and Netlify for the static
web client. It does **not** automatically submit job applications. The current
data categories, locations, retention, and policy-change notice are in
[[PRIVACY]].

Assign the incident owner, technical owner, user-response owner, and backup
administrator named in [[INCIDENT_RESPONSE]] before inviting anyone. Record
names and provider access coverage privately, outside the repository. The
backup must be able to access GitHub, Netlify, Convex, DNS, Resend, and
Turnstile, and must test that access before an owner is unavailable.

## Beta readiness and release procedure

Before admitting or re-opening beta users, the technical owner must:

1. Confirm the published links for [[PRIVACY]], [[TERMS]], and
   [[SECURITY_CONTACT]] are reachable from the product and use the current
   policy version.
2. Confirm registration requires verified email, a valid single-use invite,
   and Turnstile; confirm no invite is tied to an email before redemption.
3. Confirm required secrets are in their server/provider secret stores and no
   `VITE_*`, source file, issue, or release note contains a server credential.
   Use the configuration table in [[SECURITY]].
4. Run the release checks and deploy only as described in [[RELEASE_RUNBOOK]].
   Do not publish a directory that was rebuilt after verification.
5. In a clean isolated test account, verify the acknowledgment gate appears
   before career data is stored, that an invite cannot be reused, and that the
   account page exposes self-service export/deletion and private request guidance. Do not use production
   user data for this check.
6. Record the release label, provider deployment identifiers, check result, and
   operator decision in the private operations record. Do not record secrets,
   full URLs with query data, or user content.

## Enrollment and feedback handling

The technical owner issues time-limited invitations through the approved,
operator-keyed `enrollment.issueInvite` action. Share the raw invite only with
the intended tester through a private channel, then discard the local copy.
Do not make an email-address spreadsheet or encode an email in an invite. The
product retains only a server-held HMAC digest and minimized enrollment events.

There is no dedicated invite-revocation endpoint in this source. Before
distribution, rehearse a narrowly scoped operator expiry procedure for the exact
`alphaInvites` record and verify `expiredAt` blocks redemption/enrollment. Never
rotate the shared digest key to revoke only one invite. Expiry does not itself
revoke auth sessions; use the supported account workflow for a compromised
account. This procedure remains a release prerequisite, not a completed check.

The user-response owner gives each tester the current scope, the policy links,
and the security contact. Feedback may be collected in a support channel, but
it must not include passwords, reset or verification codes, access tokens,
resume files, job notes, application answers, or copied personal data. Triage:

| Feedback type | Owner action |
| --- | --- |
| Security, account compromise, or unauthorized data | Acknowledge privately and start [[INCIDENT_RESPONSE]]. |
| Privacy export/deletion request | Follow the procedure below; do not treat it as a vulnerability report. |
| Product defect without a security concern | Record a minimized reproduction and route it through the ordinary product backlog. |
| Access/enrollment help | Check invite expiry/reuse without revealing whether another account redeemed it. Issue a new invite only through the approved path. |

## Production data export request

**First route:** Account security downloads the owner-scoped v5 application JSON.
It includes saved evidence/drafts, discovery/profile/history, request consent and
usage metadata. It excludes Better Auth component data and provider/platform
records. Export overflow fails explicitly; never label a truncated result complete.
See [[ACCOUNT_DATA_LIFECYCLE]] for limits and [[PRIVACY]] for retained categories.

**Private route:** the tester contacts their inviter through the private channel
used for the invitation, with subject `Meritwake beta data request`. Use this
for overflow, inaccessible account controls or account/auth-profile requests.
No monitored support mailbox or Reply-To has been approved. The outbound sender
`Meritwake <meritwake@dmdtechnologies.net>` is not proof of receiving capability.
Confirm a monitored destination and response coverage in the release packet
before sending invites; never substitute the inherited maintainer's address.

1. Open a private request record containing an internal ID, date and category.
   Keep requester contact only in the private support channel.
2. Verify account and verified-mailbox control through the supported account
   workflow; never request passwords, session/reset links or tokens. Pause and
   use [[INCIDENT_RESPONSE]] when identity or mailbox control is uncertain.
3. Scope bounded owner-indexed reads to that account using the existing data
   inventory; for auth/profile data use supported Better Auth/provider operations.
   Never export passwords/hashes, session secrets, invite digests, other users'
   records or raw provider logs. A private export procedure must be rehearsed
   before claiming operational readiness; direct component-table editing is forbidden.
4. Have technical and user-response owners check completeness, categories and
   recipient, then agree on restricted private delivery with an expiry. Explain
   unsupported categories and retention limits without promising provider erasure.
5. Record completion date/categories only, remove temporary copies after delivery,
   and keep sensitive content out of tickets, reports and the repository.

## Production account-data deletion request

**First route:** Account security confirms the current password and uses Better
Auth's supported deletion. Sessions and credential accounts are removed; app
mapping disappears immediately and scheduled bounded cleanup drains career,
profile, request and owner-quota rows. Operator follow-up must check completion
and failed scheduled work; an accepted request does not prove every batch ran.

**Private route:** use the same verified private request channel above if the
control fails or is unavailable. After verifying identity and scoped intent,
explain [[PRIVACY]] exceptions and use supported account deletion/provider
operations, never a broad table deletion or a copied legacy password hash.
Verify sessions fail, career records are drained, invites are expired/unlinked
and a second account is unaffected. Record only date, categories, exception
status and operator; send a minimized completion notice privately.

Retain detached billing attempts and aggregate totals for reconciliation,
duplicate-charge prevention and the shared budget. Never refund unknown or
in-flight usage because a user deleted an account or closed the browser. HMAC
abuse counters, anonymous audits and diagnostics have no automated physical
age-out. Provider/backup retention and a reviewed cleanup schedule remain release
prerequisites; do not describe these records as immediately erased.

## Hosted generation controls and recovery

The configured source adapter is Z.ai Standard API `glm-4.7`, server-side with
separate selected-evidence consent. No Coding Plan backend, automatic retries or
Claude fallback exists. See [[RESUME_STUDIO]] and [[PRIVACY]]. Initial limits:
five active testers, 20 attempts per tester per UTC calendar month, $5/$7 warnings,
$8 admission ceiling including worst-case reservations and $10 total API ceiling
across providers. The $2 margin is headroom, not extra allowance. Verify prices,
billable token bounds, dedicated billing isolation and disabled automatic top-ups
before enabling live requests. No unpriced request may be admitted.

Set `HOSTED_AI_EXECUTION_ENABLED=false` through the approved deployment's secret/config
store to stop new admission; the ledger also supports internal `aiBudget.configure`
with `enabled: false` and the existing approved `cutoffMicroUsd` (at most
8,000,000). This requires authenticated deployment operator access, not a browser
API or enrollment key. Do not expose deployment credentials. Disabling admission does not recall dispatched requests.
Reconcile outstanding original-month liabilities before unlocking work; never
release unknown bills on timeout. See [[INCIDENT_RESPONSE]].

## Backup and retention review

There is no automatic expiry for saved resumes or request history; removal is
by role/bundle/account controls or reviewed retirement. Scan history retains 30
runs; 50 bundles and 40,000 characters per text field are save limits, not timed
retention. [[ACCOUNT_DATA_LIFECYCLE]] inventories retained accounting/security data.

Before release, record provider-supported backup capability/cost, retention and
expiry, encrypted storage/access roles, recovery/data-loss targets and a proven
restore in the release packet. These are requirements, not verified settings.
Keep a restricted deletion-reconciliation record with only necessary opaque IDs
and dates outside Git; apply intervening deletions to a quarantined restore,
verify revoked sessions/owner isolation, then reopen. Do not replay settled
provider attempts. Frontend rollback does not restore backend data; preserve
optional billing/privacy ownership fields after anonymization. Use
[[RELEASE_RUNBOOK]] and [[INCIDENT_RESPONSE]].

## Routine operating cadence

| When | Owner action |
| --- | --- |
| Before every release | Follow [[RELEASE_RUNBOOK]], including the guarded production build and endpoint verification. |
| During each beta-support review | Triage private reports; route security matters to [[INCIDENT_RESPONSE]] and data requests to the procedures above. |
| After a material policy change | Update the dated policy document and release notes, then require the in-product acknowledgment before storing career data, as described in [[PRIVACY]]. |
| After any provider-access change | Confirm a primary and backup administrator still have least-privilege access and record only the access review date. |
| When retiring the beta | Stop new enrollment, tell users how to request export/deletion, apply the retention policy, and use the incident procedure for any security concern discovered during shutdown. |

## Escalation and closure

The user-response owner uses the invitation channel and private guidance in
[[SECURITY_CONTACT]] for security reports. The incident owner decides whether a
report becomes an incident, whether a provider must be involved, and when
approved user communication is needed. Do not close an operational request
until the responsible owner records the outcome and any follow-up owner/date
in the private operations record.
