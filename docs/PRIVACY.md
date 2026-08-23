---
type: reference
title: Jobbie Alpha Privacy Notice
created: 2026-08-01
tags:
  - privacy
  - alpha
  - web
related:
  - '[[TERMS]]'
  - '[[SECURITY_CONTACT]]'
  - '[[SECURITY]]'
  - '[[RELEASE_RUNBOOK]]'
---

# Jobbie alpha privacy notice

**Effective date:** 2026-08-01
**Version:** 2026-08-01
**Applies to:** the hosted Jobbie/Career-Ops web alpha in `web/`. This notice
does not change how the separately installed, local Career-Ops CLI handles
files on a user's computer.

This is a product notice for an invited alpha, not legal advice. It must be
reviewed by qualified counsel before public use or before the data practices
change.

## What the alpha does

The hosted alpha provides verified email/password accounts, a private manual
job-pipeline workspace, and a private review queue for an owner-scoped,
metadata-only projection of locally discovered roles. A user can add a manual
role, review projected matches, change review or pipeline status, archive a
projected role, or remove a manual role. The hosted alpha does **not** receive
or store browser credentials, resumes, job-description text, local file paths,
raw captured source content, application answers, or application forms. It does
not scan job boards itself, generate or upload resumes, fill application forms,
or automatically submit applications to an employer. The local Career-Ops tools
remain separate from this hosted dataset.

## Data collected and why

| Data | Purpose | Stored or processed by |
| --- | --- | --- |
| Email address, account ID, verified-email state, password credential material, session and verification/reset records | Create, secure, verify, recover, and sign in to an account | Better Auth in the configured Convex deployment. The application does not expose authentication-component records to other users. |
| Verification and reset link email | Send single-use address-verification or password-reset links | Resend processes the destination address and message needed to deliver it. Links expire after 15 minutes. |
| Signup bot-protection token and validation result | Reduce automated account creation | Cloudflare Turnstile validates the token during signup. The application does not store the token in its own tables. |
| Job-pipeline entries: company, role title, location, job URL, source, status, optional notes, created/updated timestamps, and owning account ID | Display and manage the user's private pipeline | The `jobs` table in the configured Convex deployment. Each entry is scoped to its authenticated, verified owner. |
| Discovered-role projection: company, title, optional location, canonical HTTPS role URL, safe local record identifier, source label/provider, discovery and freshness timestamps/status, and review status | Show the private discovery review queue without copying the local discovery record | The owner-scoped `discoveredJobs` table in the configured Convex deployment. The identifier is validated as a path-free record key; no local path or raw posting content is accepted. |
| Match and review metadata: profile version, score, decision outcome, hard-filter and explanation codes, reviewer override outcome/reason, and decision/review timestamps | Explain a projected match and record the user's review decisions | Owner-scoped `discoveryMatchDecisions`, `discoveryReviewerOverrides`, and `discoveryStatusHistory` tables in the configured Convex deployment. These tables contain metadata and reviewer-entered reasons only; they do not contain resumes, job-description contents, browser state, or captured page data. |
| HMAC-derived email rate-limit key, action type, attempt count, and rate-limit-window start time | Rate-limit signup, reset, and verification resend attempts | The `authAbuseLimits` table in the configured Convex deployment. It deliberately stores an HMAC-derived key instead of the email address. |
| Alpha-invite HMAC digest, issuance/expiry/claim timestamps, a claimed account ID, and limited event category/timestamp records | Limit this early alpha to invited users and investigate invitation lifecycle failures | The `alphaInvites` and `enrollmentAuditEvents` tables in the configured Convex deployment. The application does not store a raw invite token, invitee email, IP address, or career content in its enrollment audit records. |
| Error-report metadata: deployment version, route path without query data, fixed operation type, fixed error category, and timestamp | Diagnose application failures during the alpha | Browser reports are stored in the `errorReports` table in the configured Convex deployment; backend failures use the same metadata-only structured Convex runtime log. Both deliberately exclude form values, job notes, resume files, application answers, auth tokens, passwords, email bodies, error messages, stack traces, account IDs, and full URLs or query strings. |

The current application does not implement advertising trackers, behavioral
analytics, resume uploads, application-answer collection, job-board
credentials, browser-control storage, raw job-board capture storage, or
application submission. It also does not implement a separate application
analytics or behavioral-tracking service. It does implement the limited
metadata-only error reporting described above. Infrastructure providers may
process ordinary service, delivery, or security logs under their own terms; do
not put sensitive career content in a support request or an email subject line.

## Where data is stored

Application records and account-supporting records are stored in the Convex
deployment configured for the alpha. Verification and password-reset delivery
uses Resend; signup bot checks use Cloudflare Turnstile. The static web client
is published through Netlify. The deployment configuration does not guarantee
a particular geographic region, and this notice makes no encryption or
certification claim.

## Retention and deletion

| Data | Retention in the current alpha | How to delete it |
| --- | --- | --- |
| A job-pipeline entry | Until the user removes that entry, deletes the account, or the alpha is retired. There is no automatic job-record expiry. | Select the entry's remove control in the pipeline, or delete the account from Account security. |
| A discovered-role projection and its match decisions, reviewer overrides, review-status history, and material review metadata (state, timestamp, profile version, and artifact-ready flags only) | Until the user deletes the account or the alpha is retired. Archiving changes review status but does not delete the metadata; there is no automatic expiry. | Delete the account from Account security. |
| Account and authentication records | Until the user deletes the account or the alpha is retired. | Use the Account security control and enter the current password to permanently delete the account and associated pipeline data. |
| Verification and reset links | 15 minutes, as configured in the application. | They expire automatically; no user action is needed. |
| HMAC-derived rate-limit records | The current alpha has no automated expiry job for these records; they are retained until the operator removes them or retires the alpha. | These keyed anti-abuse records are not linked to a readable account profile and may be retained temporarily for fraud prevention. |
| Alpha invite and privacy-safe audit entries | Unused invites expire; digest and event records remain until the operator removes them or retires the alpha. | Invite tokens are not tied to an email before redemption. Deletion expires a redeemed invite and retains only the privacy-safe event record. |

The Account security control downloads a portable JSON export containing only
the signed-in user's manual pipeline records, privacy acknowledgement metadata,
and the discovered-role metadata projection with its match decisions, reviewer
overrides, and review-status history. It excludes Better Auth component records,
browser credentials or state, resumes, job-description contents, local paths,
and raw captured source content. It also supports permanent account deletion
after the current password is confirmed; Better Auth removes the authentication
account while the transactional trigger removes that user's manual pipeline
records and every owner-scoped discovered-role projection record. The remaining
privacy-safe deletion audit event contains no career content. Do not include a
password, authentication link, resume, or job notes in a support email.

## Your choices and responsibilities

- Do not enter information you are not comfortable storing in this early alpha.
- You can sign out, change your password, use email recovery, remove individual
  pipeline entries, or stop using the service at any time.
- Keep your password and verification links private. The service will not ask
  for them by email.
- For a security issue, use the private channel in [[SECURITY_CONTACT]], not a
  public issue tracker.

## Changes to this notice

We will publish material changes in the repository release notes and update
the effective date and versioned source document before the changed practice
takes effect, except where an urgent security or legal requirement requires a
faster change. During the alpha, users will also be notified through the
in-product notice before they save new career data after a material policy
change. Continued use after that acknowledgement is the requested alpha
consent; it is not a substitute for any consent required by applicable law.

## Contact

For a privacy or account-data request, email **hi@santifer.io** with the
subject `Jobbie alpha data request`. For vulnerabilities or suspected security
incidents, follow [[SECURITY_CONTACT]].
