# Meritwake Web

This is the Meritwake dashboard built on Career-Ops. Its Convex worker can
discover roles from approved public ATS feeds using a saved Target Profile.
The local CLI and scanner remain separate for browser-assisted workflows.

`convex/hostedResumes.ts` now defines the hosted request/state boundary for the
selected Z.ai `glm-4.7` provider. An enrolled, verified owner must acknowledge the
current privacy notice, save a bundle and explicitly consent to sharing that
revision's source and posting. Requests expose private pending/succeeded/failed
metadata; internal completion replaces only that exact bundle revision and
clears review approval. Failed or stale output preserves saved content.
`convex/aiBudget.ts` supplies the separate durable admission ledger. Every new
attempt atomically consumes a quota slot and reserves worst-case integer
micro-USD against one shared $8 pool (including outstanding prior-month calls).
Five explicitly admitted pilot owners, including test accounts, receive at most
20 attempts per UTC month. Failure, timeout, browser cancellation and month
rollover never automatically release reservations or refund attempt quota.
Unknown bills retain their owner/global locks until trusted reconciliation;
settlement is idempotent and charges the original month. Metadata-only warning
levels are $5/$7; alert delivery remains release work.

Admission defaults off. Both the internal operator control and the server-only
`HOSTED_AI_EXECUTION_ENABLED=true` switch must be enabled, and an unexpired,
operator-reviewed price/bounds evidence reference must exist. No live price or
token proof is seeded by source. `approvePrice` must only be called after proof
covers all serialized input, completion/reasoning and fees; transport byte caps
are insufficient. Cutoff can be lowered below $8 for fee headroom. Changing a
price/bound invalidates unclaimed permits. Unexpected bills above reservation
are recorded and disable admission. These controls affect future dispatch;
already sent work remains a possible charge.

`convex/hostedResumeWorker.ts` now provides the internal `execute` action. It
reserves the request and consumes exactly one `claimDispatch` permit. That
transaction returns the current factual brief and snapshotted prices while
rechecking access/revision. `convex/hostedProvider.ts` calls only the Standard
Z.ai endpoint with `glm-4.7`, thinking disabled, no tools, no redirects, no SDK
and zero automatic retries. The network/body deadline is 45 seconds, responses
are capped at 256,000 bytes, and completed plain-text drafts reuse the
40,000-character import validator. Wrong models, unknown usage, unexpected
reasoning/tools and transport failures retain reservations and locks. Usage
settles at reserved uncached rates without assuming a cache discount: these
are conservative charge upper bounds, not independently verified invoices.
Truncated, refused or malformed output never replaces a bundle. Valid output
goes through existing revision/access checks and clears factual review.

The sole permit holder may settle at zero only when it knows no fetch occurred
(e.g. missing configuration or rejected input). Failed claims can atomically
cancel still-unclaimed reservations without affecting a worker which already
claimed one. Quota is never refunded. Once fetch begins, errors, timeouts and
browser cancellation cannot justify a zero bill. Redelivery cannot replay
inference; user retries need a new request/reservation. An action crash after
claim requires operator reconciliation, with no expiring lease or automatic retry.

Server-only names are `HOSTED_AI_ZAI_API_KEY` (dedicated Standard API key, never
a Coding Plan/local credential) and `HOSTED_AI_ZAI_BOUND_EVIDENCE` (must match
the reservation's reviewed evidence reference). Neither is a `VITE_*` variable.
**Do not set the attestation or enable paid execution until release evidence
proves this contract:** serialized request UTF-8 bytes plus 4,096 upper-bounds
all billable input tokens, and `max_tokens` with thinking disabled bounds all
billable output, with no unreserved fees. The adapter checks that conditional
input bound against the reserved ceiling (at most 200,000 tokens) and caps total
output at 8,192 tokens. Arithmetic and a matching reference do not establish the
provider contract; no live attestation, price or key is seeded. If this bound
cannot be proven, keep execution disabled and replace it with a verified model
tokenizer/contract before release. Official references:
[chat completion](https://docs.z.ai/api-reference/llm/chat-completion) and
[thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode).

All execution/ledger controls are internal. Conditional Claude pricing shares
the pool, but requests, consent and transport stay pinned to Z.ai; switching
requires a separate explicit consented implementation. Resume Studio wiring
and scheduling remain the next task: the public intent mutation does not yet
invoke this action. No live call or deployment is certified. The local workflow
remains usable. Billing tables contain no career text; complete account cleanup
and retention auditing remain separate tasks.

Run `npm run test:auth` for fake-provider execution and existing backend tests.
`convex/hostedProvider.test.ts` uses fictional evidence and intercepted fetch;
it does not certify real pricing/token bounds or hosted accounts. For the
frontend boundary, build into a disposable directory with
`HOSTED_AI_ZAI_API_KEY=fictional-hosted-provider-build-key`, then run
`HOSTED_PROVIDER_BUILD_DIR=/absolute/disposable/build node --test scripts/hosted-provider-build.test.mjs`.
Preserve release `dist`; use the production build guard for publishable artifacts.

`npm run test:authorization` also exercises authenticated hosted requests through
the actual scheduled worker with intercepted provider fetches. The integration
cases cover cross-account isolation, queued access/evidence changes, duplicate
delivery, exhausted quota, timeout, invalid output and stale completions; failed
generation keeps the previous draft and clears approval for export. All accounts,
evidence and billing bounds in these tests are fictional.

The same suite covers adversarial posting/resume instructions, unsupported
credentials and metrics, wrong-provider/refusal/tool output, per-retry charges,
and interrupted dispatch. Ledger tests use fake UTC clocks for rollover and late
billing, duplicate settlement, the shared $8 ceiling, five pilot slots and the
20-attempt quota (including re-enrollment). Provider usage-shape failures retain
reservations. These tests verify capability boundaries and mandatory review;
plain-text acceptance and literal evidence checks do not verify factual truth.
Run the focused group with
`npx vitest run --config vitest.auth.config.ts convex/aiBudget.test.ts convex/hostedProvider.test.ts convex/authorization.test.ts`.


For the current beta test path, saved-progress guide, feature limits and release
status, see [Beta testing](../docs/BETA_TESTING.md). The Fieldnotes identity is
implemented in the UI; publishing the hosted beta remains a separate release.

## Local development

For the personal first-user path without email delivery, bot checks, or an invite,
see [Local owner setup](../docs/LOCAL_OWNER_SETUP.md). It retains password sign-in,
private Convex storage, enrollment, and account ownership checks.

Use Node.js 24.

```bash
npm install
npx convex dev
npm run dev
```

`npx convex dev` provisions or selects a Convex development deployment and
writes `VITE_CONVEX_URL` to `.env.local`.

## Netlify deployment

The repository-level `netlify.toml` configures Netlify to use `web/` as its base
directory. In Netlify, set `CONVEX_DEPLOY_KEY` to a Convex production deploy key
with the `deployment:deploy` permission. Also set
`CONVEX_DEV_DEPLOYMENT_URLS` to a comma-separated list of known development
Convex deployment URLs. This lets the production build reject a development
endpoint even if it is accidentally supplied to the build.

The only supported production build command is:

```bash
npx convex deploy --cmd 'npm run build'
```

Convex supplies `VITE_CONVEX_URL` to the Vite build, deploys the functions in
`convex/`, and Netlify publishes `dist/`. The guard fails when that value is
missing, invalid, or listed as a development deployment, then verifies the
generated `dist/assets/*.js` contains only that expected production endpoint.
Never publish `dist/` using `npm run build:app`, which omits the guard.

For a manual release, use [the source-controlled release runbook](../docs/RELEASE_RUNBOOK.md).
Run `npm run release:preflight -- --expected-convex-url https://beaming-bass-637.convex.cloud --check-convex-env`
to check release inputs and production variable names without deployment or
secret-value retrieval. Missing local build settings do not prove they are
missing from Netlify; the command reports only its current environment.

## Security release gate

Before a release, run the full local security regression from `web/`. It uses
synthetic browser credentials and a loopback-only Vite server; it does not call
the deployed Convex service, send email, or create a production account.

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run test:security-regression
```

The guarded synthetic build uses a unique ignored directory under
`agent/.local/` and removes it when the checks finish. The suite preserves
`web/dist`; publish only a fresh guarded build for the intended deployment.

The command audits production dependencies, runs the backend authorization
tests, verifies the guarded production build and endpoint, checks Netlify
headers/CSP, and renders the actual UI through registration, verification,
privacy acknowledgement, role creation and update, sign-out, and sign-in. The
release workflow runs it before Release Please can create a release tag.

For focused auth checks, run `npm run test:auth` (in-memory configured Better
Auth HTTP routes and Convex functions), then `npm run test:browser-flow` and
`npm run test:browser-csp` (the real access UI with isolated client/provider
fixtures). `convex/hostedAuth.test.ts` covers invite expiry/reuse, bot and missing
configuration failures, verification gates, password reset expiry/reuse and
session revocation, and hosted rejection of local-owner credentials. Browser
checks cover safe error/recovery messages and the compiled local-owner gate.
These fixtures do not certify live email, Turnstile, or deployed accounts.

## Data and secret handling

Do not commit career records (`cv.md`, `article-digest.md`, `data/`, `reports/`,
or `config/profile.yml`), deploy keys, generated Convex credentials, browser
profiles, or production test accounts. Use ignored local files for development
and provider secret stores for deployment credentials. See
[the security policy](../docs/SECURITY.md) for the complete data classification
and handling rules.

## Authentication and data isolation

Email/password registration requires a verified address. Better Auth owns the
credential and session records, while every job record is scoped to its
verified, authenticated application owner; unauthenticated, unverified, and
cross-account requests are rejected by the backend. Registration also requires
Cloudflare Turnstile and backend rate limits.

This is a closed alpha: registration additionally requires a single-use invite
code. The backend stores only an HMAC digest of each code and expires unused
codes. An operator issues codes with the server-only `ENROLLMENT_ADMIN_KEY`;
both that value and the separate `ENROLLMENT_INVITE_KEY` digest key belong only
in the Convex deployment environment. Never place either in a `VITE_*` value,
Netlify build setting, client code, ticket, or email body.

Set the required Better Auth, Resend, Turnstile, and callback configuration
before deployment. The exact value-free names and secret-store boundaries are
documented in [the security policy](../docs/SECURITY.md#required-deployment-configuration).
The [Meritwake beta auth handoff](../docs/SECURITY.md#meritwake-beta-signup-and-recovery-configuration)
specifies the candidate sender, hostname, callback URLs, and secret-store boundaries.
Do not store job-board passwords, browser cookies, real resumes, or application
answers in Netlify environment variables.

## Current product scope

The web app supports account registration, sign-in, a saved Target Profile,
manual and daily or weekday discovery scans, a private review queue, scan
history, isolated job pipelines, manual role creation, role search, and status
tracking. The web worker requests only the approved public Greenhouse and
Ashby feeds in `convex/atsSources.ts`; it never controls a signed-in browser.
Greenhouse descriptions are requested in the same feed call and converted from
HTML to plain text; both providers can prefill Resume Studio after approval.
Captured text is capped at 30,000 characters and never replaces a saved bundle.
To start, open Target Profile, enter target roles and search settings (or import
an existing local YAML profile), select sources, enable discovery, and save.
Use Run now for an immediate scan; otherwise the Convex cron checks due
profiles daily at 13:00 UTC. Jobs with uncertain salary, location, work mode,
travel, clearance, or authorization appear for human review; clear hard
mismatches are excluded. Nothing is submitted to an employer. Resume Studio supports saved drafts and browser-local text, Word, and print-to-PDF
exports. GLM generation currently requires the opt-in local bridge described in
[Resume Studio](../docs/RESUME_STUDIO.md). Browser-assisted collection and
application form filling are not available in the hosted web app.

Before a verified account can create or change a pipeline entry, it must review
and acknowledge the current in-product privacy notice. The backend records only
the notice version and acknowledgement time on that account, then enforces the
acknowledgement for pipeline writes. The account dialog links to the published
privacy notice, terms, security contact, and the current manual export/deletion
request path.

## Privacy-safe error reporting

The app records only deployment version, route path without its query string,
fixed operation type, fixed error category, and timestamp. Browser reports use
Convex `errorReports`; failed backend mutations use the same metadata-only
Convex runtime log because failed mutation writes are rolled back. It never
records error messages or stacks, submitted form values, job notes, resume
files, application answers, tokens, passwords, email
bodies, account IDs, or full URLs. Set the matching non-secret
`VITE_APP_DEPLOYMENT_VERSION` (Netlify build) and `APP_DEPLOYMENT_VERSION`
(Convex) release labels before deployment so reports can be tied to a release.


## Saved resume bundles

Resume Studio’s resume queue groups saved bundles into **Ready to export** and
**Needs review**, with revision and saved date. Open a row to restore the draft
in Studio and download it. The queue shows roles in Discovered or Evaluated
status; marking a role Applied removes it from this preparation queue without
deleting its saved bundle. “Ready” reflects your factual review of the saved
revision, not a verified live posting or ATS ranking. Unsaved editor changes
still require review before export. The queue query returns only private bundle
metadata and is limited to the account’s 50 saved bundles.

Reviewed drafts can be downloaded directly as Word (.docx) documents, as plain
text, or printed to PDF. Word export preserves the draft's text in a single
column of ordinary paragraphs and generates the file locally in the browser.
Use the employer's requested format; these exports do not guarantee ATS ranking.

Resume Studio saves one private bundle per pipeline role: source resume text,
pasted posting, edited resume, factual-review state, and revision. Start draft
from source copies the original evidence into the editor. Save explicitly;
unsaved changes clear on refresh or sign-out. Content edits clear approval,
and downloading text or printing PDF requires factual review. Saved bundles
restore on role selection. Conflicting saves from other tabs are rejected.
Delete a bundle in Studio, remove its role, or delete the account to erase it.
Account exports include saved bundle text. Limits: 50 bundles per account and
40,000 characters per text field. Local GLM generation requires explicit consent
and a configured Coding Plan model; hosted AI generation remains unavailable.

See [Resume Studio](../docs/RESUME_STUDIO.md) and the updated
[privacy notice](../docs/PRIVACY.md) before using real career content.


## Discovery worker safety

Workers claim queued scans in a single transaction. Duplicate invocations leave
an active or completed run unchanged. A disabled or edited profile cancels a
queued scan. Enrollment and the current privacy acknowledgement are checked
again before collection and before each batch is saved, so revoked access
cannot continue writing results. Per-feed results are deduplicated while
preserving shortlist and approval decisions. See
[discovery release verification](../docs/DISCOVERY_RELEASE_VERIFICATION.md) for
local evidence and the remaining hosted-release checks.

Account export/deletion after hosted generation is documented in
[`ACCOUNT_DATA_LIFECYCLE.md`](../docs/ACCOUNT_DATA_LIFECYCLE.md), including the
schema inventory, explicit export limits, bounded cleanup, retained billing
liabilities and the separate Better Auth/private-data boundary. Export v5
includes hosted consent/request and owner-usage metadata; overflow fails instead
of producing a silently truncated download. Cleanup tests run in `npm run test:auth`.

For focused two-owner cleanup coverage, run
`npx vitest run --config vitest.auth.config.ts convex/accountLifecycle.test.ts convex/hostedAuth.test.ts`.
These in-memory tests exercise all export capacity boundaries, foreign IDs,
bounded cleanup, queued/in-flight deletion, retained unknown billing liabilities,
late provider output and Better Auth's supported deletion/session flow. Provider,
mail and bot transports are fictional; no hosted certification is implied.
