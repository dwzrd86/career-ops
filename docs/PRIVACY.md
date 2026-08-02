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

The hosted alpha provides verified email/password accounts and a private,
manual job-pipeline workspace. A user can add a role, view it, change its
status, or remove it. The alpha does **not** scan job boards, generate or
upload resumes, fill application forms, or automatically submit applications
to an employer. The local Career-Ops tools remain separate from this hosted
dataset.

## Data collected and why

| Data | Purpose | Stored or processed by |
| --- | --- | --- |
| Email address, account ID, verified-email state, password credential material, session and verification/reset records | Create, secure, verify, recover, and sign in to an account | Convex Auth in the configured Convex deployment. The application does not expose auth-table records to other users. |
| Verification and reset code email | Send an eight-digit address-verification or password-reset code | Resend processes the destination address and message needed to deliver it. Codes expire after 15 minutes. |
| Signup bot-protection token and validation result | Reduce automated account creation | Cloudflare Turnstile validates the token during signup. The application does not store the token in its own tables. |
| Job-pipeline entries: company, role title, location, job URL, source, status, optional notes, created/updated timestamps, and owning account ID | Display and manage the user's private pipeline | The `jobs` table in the configured Convex deployment. Each entry is scoped to its authenticated, verified owner. |
| HMAC-derived email rate-limit key, action type, attempt count, and rate-limit-window start time | Rate-limit signup, reset, and verification resend attempts | The `authAbuseLimits` table in the configured Convex deployment. It deliberately stores an HMAC-derived key instead of the email address. |
| Alpha-invite HMAC digest, issuance/expiry/claim timestamps, a claimed account ID, and limited event category/timestamp records | Limit this early alpha to invited users and investigate invitation lifecycle failures | The `alphaInvites` and `enrollmentAuditEvents` tables in the configured Convex deployment. The application does not store a raw invite token, invitee email, IP address, or career content in its enrollment audit records. |

The current application does not implement advertising trackers, behavioral
analytics, resume uploads, application-answer collection, job-board
credentials, or application submission. It also does not implement a separate
application telemetry service. Infrastructure providers may process ordinary
service, delivery, or security logs under their own terms; do not put sensitive
career content in a support request or an email subject line.

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
| A job-pipeline entry | Until the user removes that entry, requests account-data deletion, or the alpha is retired. There is no automatic job-record expiry. | Select the entry's remove control in the pipeline, or request account-data deletion as described below. |
| Account and authentication records | Until the user requests account-data deletion or the alpha is retired. There is no self-service account-deletion control yet. | Request deletion through the support channel below from the verified account email. |
| Verification and reset codes | 15 minutes, as configured in the application. | They expire automatically; no user action is needed. |
| HMAC-derived rate-limit records | The current alpha has no automated expiry job for these records; they are retained until the operator removes them or retires the alpha. | Include the request in an account-data deletion request. The operator will assess whether any limited record must be retained temporarily for fraud prevention or legal obligations and will explain any exception. |
| Unused alpha invite | It cannot be used after its stated expiry time. The retained HMAC digest and privacy-safe audit entries remain until the operator removes them or retires the alpha. | Invite tokens are not tied to an email address before redemption. For a redeemed invite, include the request in an account-data deletion request. |

The app currently supports per-role deletion but not a self-service full export
or account-deletion workflow. To receive a copy of the data held for an alpha
account, or to request deletion of the account and associated pipeline data,
email **hi@santifer.io** from the verified account address with the subject
`Jobbie alpha data request`. Do not include a password, authentication code,
resume, or job notes in that email. The operator will verify the request and
confirm the available export or deletion steps; this is a manual alpha process,
not an instant automated action.

## Your choices and responsibilities

- Do not enter information you are not comfortable storing in this early alpha.
- You can sign out, change your password, use email recovery, remove individual
  pipeline entries, or stop using the service at any time.
- Keep your password and verification codes private. The service will not ask
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
