---
type: reference
title: Career-Ops Security and Data Handling
created: 2026-08-01
tags:
  - security
  - privacy
  - releases
related:
  - '[[RELEASE_RUNBOOK]]'
  - '[[ARCHITECTURE]]'
---

# Security and data handling

Career-Ops contains a local job-search workspace alongside a hosted alpha. Keep those data boundaries explicit.

## Data classification

| Classification | Examples | Handling |
| --- | --- | --- |
| Public source | Application code, generated Convex bindings, tests, deployment configuration, non-personal documentation | May be reviewed and committed after the secret scan. |
| Private career records | `cv.md`, `article-digest.md`, `data/`, `reports/`, `config/profile.yml`, `portals.yml`, writing samples | Keep local and ignored. Never paste into an issue, commit, demo, or test fixture. |
| Private review metadata | Owner-scoped discovered-role projection: company, title, optional location, canonical URL, safe local record identifier, source/freshness fields, scores, decision codes, review status/history, reviewer reasons, and material review state, timestamp, profile version, and artifact-availability flags | Store only in the owner-scoped Convex discovery tables. It is a narrow projection, not a copy of a local discovery record; never add resumes, job-description text, application answers, browser credentials/state, local paths, or raw captured source content. |
| Secrets and access material | `.env*`, Netlify and Convex tokens/deploy keys, generated `.convex-home/` credentials, browser profiles | Keep outside Git and logs. Use provider secret stores and rotate if exposed. |
| Test identities | Production test accounts, real email inboxes, job-board credentials | Do not create or commit them. Use isolated, disposable test identities only when necessary. |

## Local-agent output audit

Local collection, matching, scheduling, and evaluation remain private-device
operations. Their ordinary terminal and scheduler outputs are restricted to
counts, stable error codes, safe record identifiers, and bounded role/review
metadata. They must not emit raw resume content, raw job-description content,
browser cookies or tokens, application answers, or captured page text.

`npm run profile -- show` is deliberately metadata-only: it reports versions,
counts, and discovery state rather than Target Profile form values or evidence
paths. The loopback Profile editor is the only supported interactive surface
for those values. Its temporary URL token is usable only while that local
process runs; do not paste the URL into a ticket, chat, shell history, or log.

The daily-shortlist projection remains local unless a separate authenticated
bridge is deliberately invoked. Its optional Convex-compatible payload is
limited to the fields enforced by `discovery:project`; local paths, raw content,
form values, draft materials, application answers, and browser state are
excluded. Backend and browser diagnostics use the metadata-only event contract
in `errorReporting`; do not add exception messages, request payloads, stack
traces, or full URLs to it.

## Local discovery retention and recovery

The ignored `data/autodiscovery/` workspace has no automatic retention or
remote deletion path. The local owner chooses its retention period and may
delete it only after confirming that active review/evaluation work is no longer
needed. Back up the workspace only to an encrypted local destination such as
`data/autodiscovery-backups/`; restoration must be tested in a separate private
directory. Local exports belong in `data/autodiscovery-exports/`, remain
ignored, and require a content review before sharing.

The Interceptor must use a dedicated, manually managed browser context. If it
is lost, expired, or corrupt, leave collection blocked, create a new dedicated
context, sign in manually if the source requires it, and re-enter only its safe
context identifier and HTTPS allowlist. Never restore it by exporting cookies,
storage, passwords, or session tokens from a personal browser.

No local evaluation worker credential exists in this release. If a future
explicit worker bridge requires one, treat it as a server secret: keep it in a
masked provider/local secret store outside systemd unit files and Git, rotate it
on suspected exposure or operator change, revoke the old value, and run the
release checks before re-enabling the bridge.

## Supported deployment flow

The supported production path is [[RELEASE_RUNBOOK]]. Netlify runs `npx convex deploy --cmd 'npm run build'`; the build guard rejects known development URLs and verifies the emitted bundle uses only the production Convex endpoint. Do not manually publish a frontend bundle or substitute a Convex URL.

## Account lifecycle

The application uses `@convex-dev/better-auth` with Better Auth email/password authentication. Credentials, sessions, verification records, and recovery tokens live in the Better Auth Convex component. The application-owned `users` table holds only an `authId` mapping and privacy metadata. Every manual-pipeline and discovery-projection function resolves that mapping from a verified Better Auth session before it reads or writes career data.

The hosted discovery queue is deliberately metadata-only. `discoveredJobs` may
hold an owner-scoped safe local record identifier, role metadata, source label
and provider, canonical HTTPS URL, freshness, and review status. Its companion
tables hold only match-decision codes/scores, reviewer reasons, and timestamps.
The projection must never include browser credentials or state, local paths,
resumes, job-description contents, or raw captured source content.

Signup requires a Cloudflare Turnstile token, an opaque single-use alpha invite, and an HMAC-keyed rate-limit check. The invite is reserved against an opaque keyed email value before Better Auth creates the account, then claimed by the component's transactional user trigger. Raw invite tokens and email addresses are not persisted in enrollment records.

Verification and password recovery use single-use, 15-minute Resend links. Password reset and password change revoke other sessions. The app does not expose Better Auth component records, session values, tokens, or password material to application queries.

### Required deployment configuration

Set browser values in Netlify and server values in Convex. Never copy a server secret into `VITE_*`, `.env.example`, browser code, a ticket, or logs.

| Name | Store | Purpose |
| --- | --- | --- |
| `VITE_CONVEX_URL` | Netlify build | Public production Convex endpoint. |
| `VITE_CONVEX_SITE_URL` | Netlify build | Public Convex `.site` endpoint used by the Better Auth client. Convex supplies this during the production build. |
| `VITE_TURNSTILE_SITE_KEY` | Netlify build | Public Turnstile site key. The production build guard requires it. |
| `VITE_APP_DEPLOYMENT_VERSION` | Netlify build | Non-secret release label for browser diagnostics. |
| `BETTER_AUTH_SECRET` | Convex secret | High-entropy Better Auth secret for encryption and token hashing. Generate separately for each deployment. |
| `SITE_URL` | Convex environment | Exact public Netlify origin trusted by Better Auth and used in verification and reset redirects. |
| `CONVEX_SITE_URL` | Convex built-in | Convex `.site` origin used for Better Auth HTTP routes; do not override it. |
| `AUTH_TURNSTILE_SECRET` | Convex secret | Server-only Turnstile verification credential. |
| `AUTH_TURNSTILE_HOSTNAME` | Convex environment | Expected production hostname returned by Turnstile. |
| `AUTH_RESEND_FROM`, `AUTH_RESEND_KEY` | Convex environment/secret | Verified sender identity and Resend credential for verification and recovery links. |
| `AUTH_ABUSE_KEY` | Convex secret | High-entropy HMAC key for non-reversible auth rate-limit values. |
| `ENROLLMENT_INVITE_KEY`, `ENROLLMENT_ADMIN_KEY` | Convex secrets | HMAC key for invite digests and operator-only invite issuance key. |
| `APP_DEPLOYMENT_VERSION` | Convex environment | Non-secret release label for backend diagnostics. |

Missing account-lifecycle configuration fails closed. Configure a real verified Resend sender and a production Turnstile hostname before a production cutover.

### Provider configuration audit and rotation ownership

The technical owner performs this audit by **name and scope only**. Never
retrieve, print, or paste a secret value while auditing. The provider stores
must mark deploy credentials and server secrets as masked/sealed; `VITE_*`
values must be limited to public endpoints, public site keys, and release
labels.

| Provider | 2026-08-22 name/scope audit | Required disposition |
| --- | --- | --- |
| Netlify production | `CONVEX_DEPLOY_KEY` (Builds, masked); `NODE_VERSION` (Builds and post-processing) | Retain the deploy key only in the build scope; retain Node version as a non-secret build setting. No other Netlify production variables were configured. |
| Convex production (`beaming-bass-637`) | `JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL` | These are legacy identity settings. Do not remove or alter them until the documented production identity migration is approved. The Better Auth and enrollment variables in the table above are not yet configured in production. |

The technical owner owns every secret in the required deployment-configuration
table above. Rotate a server secret or deploy key through the provider's
revocation-and-replacement flow on suspected exposure, loss of administrator
access, or a provider-required rotation event; store the replacement only in
the same provider secret store, remove the old value, then release through
[[RELEASE_RUNBOOK]]. Follow the detailed sequence in
[[INCIDENT_RESPONSE#Exposed credential rotation]]. Public `VITE_*` values are
reviewed on every release rather than rotated as secrets.

### Production migration boundary

The Better Auth component has been deployed and browser-validated only on the development Convex deployment. The production deployment remains on the legacy identity store until a migration is run. Legacy password hashes must not be copied into Better Auth or manually edited; production users require a controlled account migration and password-reset process that preserves their application-owned `users`, manual `jobs`, and owner-scoped discovery-projection ownership mappings. Do not deploy the Better Auth schema to production before that runbook and the account-export/deletion workflow are tested against a disposable deployment.

## Convex access matrix

`Verified user` means a Better Auth session with `emailVerified` set and a matching app-owned `users.authId` record. Internal endpoints have no public `api.*` reference.

| Endpoint | Access and boundary |
| --- | --- |
| `jobs:list`, `jobs:create`, `jobs:updateStatus`, `jobs:remove` | Require a verified user. Reads are constrained by `ownerId`; updates and deletes use a non-enumerating owner comparison. New jobs require current privacy acknowledgement. |
| `discovery:list`, `discovery:history`, `discovery:project`, `discovery:shortlist`, `discovery:archive`, `discovery:approveForEvaluation`, `discovery:overrideDecision` | Require a verified, enrolled owner; mutations also require current privacy acknowledgement. Every read and mutation is constrained by the matching `ownerId`. Projected data is limited to the documented metadata fields, and returned records omit owner identifiers. |
| `account:exportData`, `account:recordExportRequest`; Better Auth account deletion trigger | The export and export-event record require a verified owner. The portable export contains that owner's manual jobs, privacy acknowledgement, and discovery metadata projection/history only. The deletion trigger removes that owner's manual jobs and all discovery records/history before deleting the application-owned user mapping; it retains only the privacy-safe deletion audit event. |
| `privacy:status`, `privacy:acknowledge`; `enrollment:status` | Require a verified, enrolled user and operate only on that user's app record. |
| `enrollment:issueInvite` | Operator action protected by `ENROLLMENT_ADMIN_KEY`; returns the raw invite once and stores only an HMAC digest. |
| `enrollment:reserveInvite`, `enrollment:createInvite`; `abuse:consume`; Better Auth trigger handlers | Internal only. They reserve and claim an invite, maintain opaque abuse counters, and create or delete app-owned user data in response to component user changes. |
| Better Auth `/api/auth/*` HTTP routes | Registered exclusively by `authComponent.registerRoutes`. They provide sign-up, sign-in, link verification, recovery, password change, session management, and later account deletion when enabled. |
| `errorReporting:reportClient` | May be called pre-auth; accepts only allowlisted metadata and never persists form values, messages, stacks, tokens, or full URLs. |

## Verification

Run `cd web && npm run test:security-regression` before release. The gate audits dependencies, runs auth-boundary tests, validates the guarded production build and headers, and drives the complete UI in an isolated browser mock. Pull requests also run `npm run test:authorization`: an isolated Convex test deployment provisions two disposable Better Auth accounts and verifies cross-account reads, updates, deletes, exports, and account deletion remain owner-scoped. Additionally, exercise a disposable deployment with a real Resend sender and mailbox before promoting an identity migration.
