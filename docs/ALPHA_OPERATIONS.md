---
type: reference
title: Jobbie Closed Alpha Operations
created: 2026-08-01
tags:
  - alpha
  - operations
  - privacy
related:
  - '[[INCIDENT_RESPONSE]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[PRIVACY]]'
  - '[[SECURITY_CONTACT]]'
---

# Jobbie closed alpha operations

This runbook operates the limited Jobbie alpha without a hidden roster of user
email addresses. It covers normal readiness, enrollment, feedback, and the
manual production data export/deletion process. For suspected security events,
use [[INCIDENT_RESPONSE]] immediately.

## Current alpha scope and owners

Jobbie stores verified-account and manually entered job-pipeline data in the
configured Convex deployment. It uses Resend for verification and recovery
mail, Cloudflare Turnstile for signup bot checks, and Netlify for the static
web client. It does **not** automatically submit job applications. The current
data categories, locations, retention, and policy-change notice are in
[[PRIVACY]].

Assign the incident owner, technical owner, user-response owner, and backup
administrator named in [[INCIDENT_RESPONSE]] before inviting anyone. Record
names and provider access coverage privately, outside the repository. The
backup must be able to access GitHub, Netlify, Convex, DNS, Resend, and
Turnstile, and must test that access before an owner is unavailable.

## Alpha readiness and release procedure

Before admitting or re-opening alpha users, the technical owner must:

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
   account page exposes the manual data-request links. Do not use production
   user data for this check.
6. Record the release label, provider deployment identifiers, check result, and
   operator decision in the private operations record. Do not record secrets,
   full URLs with query data, or user content.

## Enrollment and feedback handling

The technical owner issues time-limited invitations through the approved,
operator-keyed invite function. Share the raw invite only with the intended
tester through a private channel, then discard the local copy. Do not make an
email-address spreadsheet or encode an email in an invite. The product retains
only a server-held HMAC digest and privacy-safe enrollment audit events.

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

**Trigger:** a verified-account user emails `hi@santifer.io` with subject
`Jobbie alpha data request` asking for an export. This is a manual alpha
process; no self-service complete export currently exists.

1. The user-response owner opens a private request record with an internal ID,
   request date, and `export` category. Keep the requester email only in the
   support mailbox, not the request record, repository, or ticket.
2. Confirm the request came from the verified account address. If control of
   that mailbox or account is in doubt, stop and use the account-compromise
   procedure in [[INCIDENT_RESPONSE]]; do not disclose data while identity is
   uncertain.
3. The technical owner identifies only records owned by the verified account:
   the user's application data and the account/authentication records that the
   provider can export safely. Do not include other users' records, secret
   configuration, raw provider logs, or internal security audit material.
4. The user-response owner and technical owner review the export for scope and
   recipient before delivery. Agree on a private delivery method with the
   requester; if a safe method cannot be verified, do not send the export.
5. Deliver the approved export, record delivery date and the categories
   delivered, and retain no extra local copy. Explain any category that cannot
   be exported or any temporary retention exception in plain language.

## Production account-data deletion request

**Trigger:** a verified-account user emails `hi@santifer.io` with subject
`Jobbie alpha data request` asking to delete the account and associated
pipeline data.

1. Open the same minimized private request record, with a `deletion` category,
   and verify the request came from the verified account address. Pause if an
   account-compromise report or identity uncertainty exists.
2. The technical owner lists the requester's owned application records and
   applicable account/authentication records using provider-supported tools.
   Never use a broad export or delete query that could affect another account.
3. The user-response owner explains the current retention exceptions from
   [[PRIVACY]] before executing deletion: for example, any limited fraud- or
   legal-retention exception must be assessed and explained, not silently kept.
4. After the requester confirms the scoped action, the technical owner deletes
   the eligible owned pipeline and account data through supported provider
   operations. Verify that the account can no longer access retained
   application data. Do not claim deletion from backups or provider systems
   beyond what the provider documents.
5. Send a concise completion notice with the date, deleted categories, and any
   stated exception. Record only the completion date, categories, exception
   status, and operator in the private operations record; remove temporary
   export files and notes containing personal data.

## Routine operating cadence

| When | Owner action |
| --- | --- |
| Before every release | Follow [[RELEASE_RUNBOOK]], including the guarded production build and endpoint verification. |
| During each alpha-support review | Triage private reports; route security matters to [[INCIDENT_RESPONSE]] and data requests to the procedures above. |
| After a material policy change | Update the dated policy document and release notes, then require the in-product acknowledgment before storing career data, as described in [[PRIVACY]]. |
| After any provider-access change | Confirm a primary and backup administrator still have least-privilege access and record only the access review date. |
| When retiring the alpha | Stop new enrollment, tell users how to request export/deletion, apply the retention policy, and use the incident procedure for any security concern discovered during shutdown. |

## Escalation and closure

The user-response owner uses `hi@santifer.io` and the private guidance in
[[SECURITY_CONTACT]] for security reports. The incident owner decides whether a
report becomes an incident, whether a provider must be involved, and when
approved user communication is needed. Do not close an operational request
until the responsible owner records the outcome and any follow-up owner/date
in the private operations record.
