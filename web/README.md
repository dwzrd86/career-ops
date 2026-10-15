# Career Ops Web

This is the Netlify-hosted dashboard for Career-Ops. Its Convex worker can
discover roles from approved public ATS feeds using a saved Target Profile.
The local CLI and scanner remain separate for browser-assisted workflows.

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
