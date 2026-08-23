---
type: reference
title: Jobbie Alpha Incident Response
created: 2026-08-01
tags:
  - security
  - incident-response
  - alpha
related:
  - '[[ALPHA_OPERATIONS]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[SECURITY]]'
  - '[[SECURITY_CONTACT]]'
  - '[[PRIVACY]]'
---

# Jobbie alpha incident response

Use this procedure for a suspected account compromise, exposed credential,
unauthorized-data report, abusive signup spike, or a release that must be
rolled back. It is an operational runbook, not a promise of notification
timelines or a substitute for legal advice.

## Required owners and safe recordkeeping

Before admitting alpha users, assign these roles and a backup for each in a
private, access-controlled operations record outside this repository:

| Role | Required action |
| --- | --- |
| Incident owner | Opens and coordinates the incident, decides when containment and recovery are complete, and leads the review. |
| Technical owner | Operates Netlify, Convex, Resend, Turnstile, GitHub, DNS, and the release rollback path. |
| User-response owner | Receives private reports and data requests at `hi@santifer.io`, sends approved updates, and keeps reporter contact details out of incident notes. |
| Backup administrator | Can take over if an owner is unavailable and has tested access to every provider above. |

Give each incident an internal ID and record only: detection time, reporter
channel (not their address), affected-account count or `unknown`, services,
the release label, decisions, and timestamps. Keep emails, tokens, passwords,
verification codes, resumes, job notes, application answers, full URLs with
queries, and raw provider exports out of the incident record, GitHub, and chat.
Use [[SECURITY_CONTACT]] for private reports and [[PRIVACY]] for data requests.

## First actions for every incident

1. The incident owner starts a private incident record and records the UTC
   detection time, the reporter channel, the suspected service, and the current
   release label. Do not copy sensitive report contents into it.
2. The technical owner preserves only privacy-safe evidence: deployment ID,
   route path, fixed error category, provider audit-event identifiers, and
   aggregate counts. Do not download unrelated account data.
3. Decide whether access, signup, a credential, a deployment, or an affected
   account needs immediate containment. Make the smallest reversible change
   that stops further harm.
4. The user-response owner acknowledges a private security report using the
   channel in [[SECURITY_CONTACT]]. Do not request a password, token, code, or
   another person's career data.
5. Escalate to the relevant provider's private support channel when provider
   logs, account recovery, a suspected platform issue, or service restoration
   requires it. Share only the minimum incident ID and evidence needed.

## User-reported account compromise

**Trigger:** a user says they did not authorize a sign-in, password change, or
account activity, or that their email/password may be compromised.

1. The user-response owner asks the reporter to use the product's password
   recovery flow from the account page; never accept or reset a password by
   email. The documented password-change flow verifies the current password
   and invalidates the account's other sessions; see [[SECURITY]].
2. If the reporter still controls the verified email, instruct them to reset
   the password, use a new unique password, and sign in again. Ask them to
   report only the approximate time and route of suspicious activity.
3. If email control is also in doubt, do not disclose account data or alter
   ownership based solely on an email request. The incident owner pauses any
   manual export/deletion request and obtains a safe, provider-supported
   recovery path before proceeding.
4. The technical owner reviews only the account's necessary authentication and
   privacy-safe error metadata. Confirm whether a password change, recovery,
   or deployment fault could explain the report; do not inspect job notes or
   application content unless needed to establish scope.
5. If an unauthorized change is confirmed, contain the cause, guide the user
   through the recovery step above, and use the unauthorized-data procedure if
   data may have been accessed. Jobbie does not automatically submit job
   applications, so do not imply that an external application was submitted.
6. Record the outcome as `unconfirmed`, `contained`, or `confirmed` plus the
   minimum evidence category, then proceed to the post-incident review when
   the account is stable.

## Exposed credential rotation

**Trigger:** a secret, deploy key, API key, password, access token, private
key, generated Convex credential, or browser profile may have been exposed.

1. Treat the report as real until disproved. Remove the secret from the public
   location without copying its value into an issue, commit, terminal history,
   or incident record. If it entered Git history, restrict access first and
   follow the hosting provider's private remediation guidance.
2. The technical owner revokes the suspected credential at its issuing
   provider and creates a replacement with the least required access. Rotate
   related credentials when the exposure could reach them: GitHub/deploy keys,
   Netlify deploy access, Convex deployment or signing keys, Resend API keys,
   Turnstile secrets, DNS credentials, and `ENROLLMENT_ADMIN_KEY` as applicable.
3. Store the replacement only in the appropriate provider secret store. Never
   place server-only values in `VITE_*`, source control, an email, or a ticket.
   Update the affected provider configuration and remove the revoked value.
4. For `ENROLLMENT_INVITE_KEY`, recognize that rotation invalidates outstanding
   invite digests; tell the user-response owner to issue replacement invites
   through the approved operator path without keeping an email roster.
5. Deploy and verify the fix with [[RELEASE_RUNBOOK]]. Confirm that only the
   intended production Convex endpoint is bundled and that authentication,
   enrollment, and error reporting still use the expected release label.
6. Review provider audit history for misuse from the exposure window and use
   the unauthorized-data procedure if access to user data is plausible.

## Unauthorized-data report

**Trigger:** a report or evidence suggests that one user could view, alter,
export, delete, or receive another user's data.

1. Tell the reporter to stop interacting with the data and not retain or share
   it. Ask only for the affected feature, approximate time, and safe steps to
   reproduce; do not ask them to forward the data.
2. The technical owner disables or rolls back the smallest affected surface.
   Use [[RELEASE_RUNBOOK]] if a deployed frontend or Convex change is involved.
   Preserve only route, release label, account-count estimate, and provider
   audit identifiers required to investigate.
3. Reproduce with an isolated disposable test identity and synthetic data where
   possible. Do not use a real alpha account or browse unrelated production
   records to prove the issue.
4. Determine the scope from authorization rules, deployment history, and
   necessary provider audit metadata. Separate `confirmed access`, `attempt
   blocked`, and `unknown`; do not guess.
5. The incident owner decides with qualified legal/privacy advice whether and
   how affected people or authorities must be notified. The user-response owner
   sends only approved, factual notices through a private channel.
6. Restore access only after the fix, relevant authorization tests, and release
   verification pass. Keep remediation evidence privacy-safe.

## Abusive signup spike

**Trigger:** aggregate sign-up attempts, Turnstile failures, verification
requests, or HMAC-keyed rate-limit rejections rise unexpectedly.

1. Record the UTC window, aggregate counts, release label, and affected
   providers. Do not create a list of attempted email addresses: the alpha's
   abuse table deliberately uses HMAC-derived keys instead.
2. Verify that the released frontend has a configured Turnstile site key and
   the Convex deployment has the matching server secret and hostname policy.
   Verify that the existing server-side signup, reset, and resend limits are
   rejecting excess attempts as designed.
3. Stop issuing new invites while investigating. If the attack continues or
   protects no users, the technical owner applies the provider's narrowest
   available rate-limit or access rule and documents the provider change by
   identifier, not by secret or raw request data.
4. If signup must be paused, publish a reviewed static maintenance message or
   temporarily remove the signup capability through a verified release. Keep
   sign-in and recovery available when safe; use [[RELEASE_RUNBOOK]] for every
   production change.
5. Before reopening signup, verify a clean isolated test registration, confirm
   the rate-limit window has recovered, and record the decision and aggregate
   evidence. Do not compensate by collecting a hidden list of user emails.

## Service rollback

**Trigger:** a production release breaks authentication, enrollment,
authorization, data integrity, availability, headers/CSP, or exposes a
security regression.

1. The incident owner declares rollback and records the current release label
   and observed impact. The technical owner stops any further deploys.
2. Follow the exact Netlify and Convex rollback sequence in
   [[RELEASE_RUNBOOK]]. Restore the last known-good frontend and the matching
   Convex backend or redeploy its reviewed commit.
3. Repeat the runbook's production-bundle endpoint check. Then exercise the
   smallest safe smoke flow needed for the fault, without real career data.
4. Keep the defective release unavailable until the root cause is fixed,
   authorization tests and build/header checks pass, and a reviewed release is
   ready. Record the rollback deployment IDs and verification result only.

## Local discovery scheduler containment and recovery

**Trigger:** a scheduled local collector is running unexpectedly, repeatedly
fails, logs more than safe metadata, or cannot reach the dedicated Interceptor
context.

1. Stop future runs immediately with `npm run scheduler:status -- --kill-switch on`.
   If the timer itself must stop, run `npm run scheduler:systemd -- uninstall`.
   Both commands are user-scoped and do not require root.
2. Record only the safe scheduler status, error code, source ID, and time. Do
   not copy journal output containing career content, browser details, tokens,
   cookies, or profile paths into an incident record.
3. For a missing context, login page, CAPTCHA, or access denial, keep the run
   `blocked`. Repair the manually managed `Jobbie Discovery` browser profile
   and exact source allowlist; never bypass a challenge or export browser
   credentials.
4. For a collector failure, inspect the approved local adapter and its
   metadata-only contract. Do not add a secret to a systemd unit, environment
   variable, log, or ticket as a workaround.
5. After one successful manual collection, inspect `npm run scheduler:systemd
   -- status`, reinstall the user timer if needed, and turn the kill switch off.
   The systemd timer is non-persistent, so a VM shutdown does not cause a
   surprise catch-up run on recovery.

## Post-incident review

Start the review after containment, no later than the next working cycle.
The incident owner prepares it; the technical and user-response owners review
it; the backup administrator confirms the action owner and due date for each
follow-up.

1. Write a privacy-safe timeline: detection, containment, recovery,
   notification decision, and closure times; affected services and account
   count; and evidence categories.
2. State what happened, user impact, root cause or remaining uncertainty, the
   controls that worked, and the controls that did not. Do not include secrets
   or personal career data.
3. Create named, dated corrective actions for code, configuration, monitoring,
   documentation, provider access, or training. Link release work to
   [[RELEASE_RUNBOOK]] and policy changes to [[PRIVACY]] when relevant.
4. Decide whether a material policy or user communication is required. Publish
   only an approved, factual summary; do not disclose exploit details before
   users are protected.
5. Close the incident only after every urgent action is complete or formally
   owned with a due date, and record the closure decision in the private
   operations record.
