---
type: reference
title: Meritwake Beta Privacy Notice
created: 2026-08-01
tags:
  - privacy
  - beta
  - web
related:
  - '[[TERMS]]'
  - '[[SECURITY_CONTACT]]'
  - '[[SECURITY]]'
  - '[[RELEASE_RUNBOOK]]'
---

# Meritwake beta privacy notice

**Effective date:** 2026-10-24
**Version:** 2026-10-24-meritwake-hosted-ai-v1
**Applies to:** the hosted Meritwake/Career-Ops web beta in `web/`. This notice
does not change how the separately installed, local Career-Ops CLI handles
files on a user's computer.

This is a product notice for an invited beta, not legal advice. It must be
reviewed by qualified counsel before public use or before the data practices
change.

## Local discovery boundary

The separately installed local discovery tools keep their discovered-job
workspace on the user's device. This may include locally retained job-detail
snapshots, Target Profile form values, and generated review materials. The
hosted beta neither receives nor manages that workspace, so deleting a hosted
account does not delete local records, local backups, or local exports.

Local discovery data has no automatic retention period: the local owner must
choose a retention period, review it before enabling a recurring scheduler, and
delete or securely retain the workspace accordingly. An owner who wants a
backup should use an encrypted local destination, keep the backup key separate,
and never include a browser profile, cookies, tokens, passwords, or provider
credentials. See [[SECURITY]] and `DATA_CONTRACT.md` for the local boundary.

## What the beta does

The hosted beta provides verified email/password accounts, a private manual
job pipeline, saved per-role resume bundles, a saved Target Profile, and an owner-scoped discovery review queue.
When discovery is enabled, a scheduled server worker requests public Greenhouse
and Ashby job-board feeds, compares listings with the saved profile, and stores
review metadata and available public posting text for viable roles. Users can also request a scan. Imported
local Target Profile YAML is read in the browser; only selected search settings
are saved when the user submits the form. The internal worker also retains up to 30,000 characters of available public
ATS plain-text posting content (Ashby and converted Greenhouse descriptions) in each owner’s discovery record.
Approving a new pipeline role copies that snapshot into the role for Resume Studio;
repeat approval leaves existing roles and saved bundles unchanged. The public
local-projection API still rejects posting content. Resume Studio separately stores source resume text,
user-pasted or discovery-prefilled job descriptions, edited drafts, revision numbers, and factual-review
timestamps when the user selects Save bundle. A successful hosted generation
also updates that saved bundle with an unreviewed draft at the matching revision. Up to 50 bundles per account
are supported, with each text field limited to 40,000 characters. Hosted generation, when configured and enabled, sends only the selected saved
source resume, job posting, company/title and factual-tailoring instructions to
**Z.ai Standard API (`glm-4.7`)** through a server-side Convex worker, with explicit
sharing consent. It does not use a shared Coding Plan subscription. No account
email, Target Profile, other roles or provider key is included in that request.
There is no automatic provider switch or retry. Claude is a conditional future
alternative requiring a reviewed implementation, notice and matching consent;
it is not a configured fallback. Generation is implemented in source but remains
release-gated; this notice does not certify live provider availability.

The optional local development connection instead sends selected evidence to
Z.ai through the user's OpenCode setup. Downloaded briefs contain that evidence.
OpenCode history and downloaded files are outside dashboard account deletion.
See [[RESUME_STUDIO]]. Unsaved editor text is
cleared on refresh or sign-out. The hosted beta does **not** store browser
credentials, local file paths, raw captured source content,
application answers, or application forms. It does
not fill application forms or automatically submit applications to employers.
The local Career-Ops tools remain separate from this hosted dataset.

## Data collected and why

| Data | Purpose | Stored or processed by |
| --- | --- | --- |
| Email address, account ID, verified-email state, password credential material, session and verification/reset records | Create, secure, verify, recover, and sign in to an account | Better Auth in the configured Convex deployment. The application does not expose authentication-component records to other users. |
| Verification and reset link email | Send single-use address-verification or password-reset links | Resend processes the destination address and message needed to deliver it. Links expire after 15 minutes. |
| Signup bot-protection token and validation result | Reduce automated account creation | Cloudflare Turnstile validates the token during signup. The application does not store the token in its own tables. |
| Job-pipeline entries: company, role title, location, job URL, source, status, optional notes and public posting snapshot, created/updated timestamps, and owning account ID | Display and manage the user's private pipeline | The `jobs` table in the configured Convex deployment. Each entry is scoped to its authenticated, verified owner. |
| Saved resume bundle: owning account and job IDs, original source resume text, pasted or prefilled job description, edited resume text, revision, review timestamp, and last update time | Resume Studio saves and restores one private bundle per pipeline role | The owner-scoped `resumeBundles` table in Convex. Content is stored only on an explicit save; hosted generation shares selected evidence with Z.ai only after separate consent. Local OpenCode is a separate optional path. |
| Target Profile search settings: target roles, locations, work policy, salary floor, authorization and clearance preferences, exclusions, expertise, selected feed providers, and scan schedule | Filter and rank public job-board listings for the signed-in user | The owner-scoped `targetProfiles` table in Convex. The profile does not contain a resume file or local path. |
| Scan run metadata: trigger, timing, status, feed success/failure counts, and match counts | Show scan history and troubleshoot failures | The owner-scoped `discoveryScanRuns` table in Convex. At most 30 recent runs are retained per user. |
| Discovered-role projection: company, title, optional location, canonical HTTPS role URL, safe local record identifier, source label/provider, discovery and freshness timestamps/status, and review status | Show the private discovery review queue without copying the local discovery record | The owner-scoped `discoveredJobs` table in the configured Convex deployment. The identifier is validated as a path-free record key; no local path or raw local posting content is accepted by the projection API. The internal public-feed worker may separately retain bounded plain-text posting content, copied to new pipeline roles on approval. |
| Match and review metadata: profile version, score, decision outcome, hard-filter and explanation codes, reviewer override outcome/reason, and decision/review timestamps | Explain a projected match and record the user's review decisions | Owner-scoped `discoveryMatchDecisions`, `discoveryReviewerOverrides`, and `discoveryStatusHistory` tables in the configured Convex deployment. These tables contain metadata and reviewer-entered reasons only; they do not contain resumes, job-description contents, browser state, or captured page data. |
| HMAC-derived email rate-limit key, action type, attempt count, and rate-limit-window start time | Rate-limit signup, reset, and verification resend attempts | The `authAbuseLimits` table in the configured Convex deployment. It deliberately stores an HMAC-derived key instead of the email address. |
| Beta-invite HMAC digest, issuance/expiry/claim timestamps, a claimed account ID, and limited event category/timestamp records | Limit this early beta to invited users and investigate invitation lifecycle failures | The `alphaInvites` and `enrollmentAuditEvents` tables in the configured Convex deployment. The application does not store a raw invite token, invitee email, IP address, or career content in its enrollment audit records. |
| Hosted generation request: role label, bundle/revision reference, provider/model, consent and policy versions, status/fixed failure category and timestamps | Dispatch selected-role work and reject stale completion | Owner-scoped `hostedResumeRequests` in Convex; no duplicate resume/posting/draft body in the request row. The worker reads the saved bundle. |
| AI attempt and quota metadata: pricing/bounds, reserved/settled charges, usage counts, opaque attempt/request IDs and monthly enrollment | Enforce five active testers, 20 attempts per tester per UTC month and the shared API ceiling | Convex billing/quota tables. Z.ai receives the selected evidence for inference, not the ledger or account identity. |
| Error-report metadata: deployment version, route path without query data, fixed operation type, fixed error category, and timestamp | Diagnose application failures during the beta | Browser reports are stored in the `errorReports` table in the configured Convex deployment; backend failures use the same metadata-only structured Convex runtime log. Both deliberately exclude form values, job notes, resume files, application answers, auth tokens, passwords, email bodies, error messages, stack traces, account IDs, and full URLs or query strings. |

The public ATS feed operators receive a normal server request for their feed;
the request does not include the user's Target Profile or account identity.
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
deployment configured for the beta. Verification and password-reset delivery
uses Resend; signup bot checks use Cloudflare Turnstile. The static web client
is published through Netlify. The inference provider processes the selected evidence and returns a draft.
Provider-side retention, region, training use, cache handling and deletion terms
for the dedicated Standard API account have not yet been verified. They must be
confirmed and this notice updated before live evidence sharing is enabled; no
zero-retention or no-training promise is made. See [[ACCOUNT_DATA_LIFECYCLE]].
The deployment configuration does not guarantee
a particular geographic region, and this notice makes no encryption or
certification claim.

## Retention and deletion

| Data | Retention in the current beta | How to delete it |
| --- | --- | --- |
| A job-pipeline entry | Until the user removes that entry, deletes the account, or the beta is retired. There is no automatic job-record expiry. | Select the entry's remove control in the pipeline, or delete the account from Account security. |
| Saved resume bundle | Until the user deletes the bundle, removes its pipeline role, deletes the account, or the beta is retired. There is no automatic expiry. | Use Delete saved bundle in Resume Studio, remove the role, or delete the account. Downloaded exports and unsaved editor text are separate copies. |
| Target Profile | Until the user deletes the account or the beta is retired. Disabling discovery stops future scheduled scans but does not delete the profile. | Delete the account from Account security. |
| Scan run history | The 30 most recent runs per account, until account deletion or beta retirement. | Delete the account from Account security. |
| A discovered-role projection and its match decisions, reviewer overrides, review-status history, and material review metadata (state, timestamp, profile version, and artifact-ready flags only) | Until the user deletes the account or the beta is retired. Archiving changes review status but does not delete the metadata; there is no automatic expiry. | Delete the account from Account security. |
| App profile and account/authentication records | App profile until deletion; Better Auth manages credential, session and verification records. Expiry does not certify immediate physical erasure. | Use supported Account security deletion with the current password; private auth-data requests follow the process below. |
| Hosted request history | Until account, corresponding role or saved-bundle deletion, or beta retirement; no automatic age-out. | These deletions drain request records in bounded scheduled batches. |
| Owner usage/pilot membership | Until account deletion or beta retirement; monthly quota does not imply monthly row deletion. | Account deletion removes owner quota rows and pilot membership. |
| AI billing and aggregate totals | No automatic age-out; retained for reconciliation, duplicate-charge prevention and budget integrity. Unresolved liabilities must remain reserved. | Account deletion detaches the owner ID from attempt records but keeps opaque IDs, pricing/usage and charges. Global totals remain. |
| Error metadata and anonymous audits | No automatic age-out; retained for diagnostics and incident investigation until reviewed operator cleanup or beta retirement. | Private requests are assessed for applicable categories; no career text is retained in these records. |
| Provider logs, delivered mail and platform backups | Provider-managed; current retention, access and expiry settings are unverified release prerequisites. | App deletion cannot erase these copies. Operator requests use supported provider processes; no immediate purge is promised. |
| Verification and reset links | 15 minutes, as configured in the application. | They expire automatically; no user action is needed. |
| HMAC-derived rate-limit records | The current beta has no automated expiry job for these records; they are retained until the operator removes them or retires the beta. | These keyed anti-abuse records are not linked to a readable account profile and may be retained temporarily for fraud prevention. |
| Beta invite and privacy-safe audit entries | Unused invites expire; digest and event records remain until the operator removes them or retires the beta. | Invite tokens are not tied to an email before redemption. Deletion expires a redeemed invite and retains only the privacy-safe event record. |

The Account security control downloads a portable JSON export (v5) of the
signed-in user's app profile, jobs, saved evidence/drafts, Target Profile, scan
and discovery history, policy acknowledgement, hosted request/consent history,
owner usage/attempts, digest-free invite metadata and privacy/enrollment events.
It excludes Better Auth component records, reusable credentials, tokens/hashes,
platform logs, provider records, backups and local files. It fails rather than
silently returning a partial export when any category or platform size limit is
exceeded. See [[ACCOUNT_DATA_LIFECYCLE]] for exact bounds; request a complete
private export when the app reports an overflow.

The permanent account deletion control uses Better Auth's supported password-confirmed flow
to remove the auth user, credential accounts and sessions. The app-user mapping
is removed immediately; owned career, profile, request and usage records drain
in bounded scheduled batches. Large cleanups are asynchronous and failures need
operator attention. Claimed invites expire and lose their account link. Only
anonymous deletion events and the billing/security records described above
remain. Deletion does not refund or recall a dispatched provider request;
late responses cannot recreate deleted app records. Unsaved browser text,
downloads, local OpenCode history, delivered mail and provider/backup copies
require separate handling.

For private account/auth-profile access, export overflow, failed cleanup or a
deletion request that cannot use the app, contact the person who invited you
through the private channel used for your invitation, with subject
`Meritwake beta data request`. The operator verifies account/mailbox control
without asking for passwords or links, limits the scope to your records and uses
supported account/provider operations. Credentials, reset links and security
secrets are never returned. Identity uncertainty pauses disclosure. The operator
explains categories delivered/deleted and any justified retention exceptions;
the self-service download is not a complete authentication-data export.

Backups require an approved retention schedule, encrypted restricted storage,
a tested restore and a private deletion-reconciliation process before release.
Restores must apply intervening deletions before reopening access, so recovery
does not resurrect deleted accounts. No production backup activation or restore
has been certified by local tests. See [[ALPHA_OPERATIONS]] and
[[RELEASE_RUNBOOK]].

## Your choices and responsibilities

- Do not enter information you are not comfortable storing in this early beta.
- You can sign out, change your password, use email recovery, remove individual
  pipeline entries, or stop using the service at any time.
- Review every generated claim against your evidence, including qualifications,
  dates and metrics. Literal keyword matches do not verify facts. New drafts and
  edits clear approval; review is required before Word/text/PDF export. No AI
  output is automatically submitted to an employer.
- Keep your password and verification links private. The service will not ask
  for them by email.
- For a security issue, use the private channel in [[SECURITY_CONTACT]], not a
  public issue tracker.

## Changes to this notice

We will publish material changes in the repository release notes and update
the effective date and versioned source document before the changed practice
takes effect, except where an urgent security or legal requirement requires a
faster change. During the beta, users will also be notified through the
in-product notice before they save new career data after a material policy
change. Continued use after that acknowledgement is the requested beta
consent; it is not a substitute for any consent required by applicable law.

## Contact

For a privacy or account-data request, contact the person who invited you
through the private channel used for your invitation. You can also export
your data or delete your account through Account security in the app. No
public support mailbox has been configured for this beta yet. Do not send
passwords, verification links, resumes or other sensitive data in a support
message. For suspected security incidents, follow [[SECURITY_CONTACT]].
