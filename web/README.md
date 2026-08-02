# Career Ops Web

This is the Netlify-hosted dashboard for Career-Ops. The existing local CLI and
scanner remain the automation layer; this app stores web-created pipeline data
in Convex.

## Local development

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

## Security release gate

Before a release, run the full local security regression from `web/`. It uses
synthetic browser credentials and a loopback-only Vite server; it does not call
the deployed Convex service, send email, or create a production account.

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run test:security-regression
```

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

Email/password registration requires a verified address. Convex Auth owns the
account records, and every job record is scoped to its verified, authenticated
owner; unauthenticated, unverified, and cross-account requests are rejected by
the backend. Registration also requires Cloudflare Turnstile and backend rate
limits.

This is a closed alpha: registration additionally requires a single-use invite
code. The backend stores only an HMAC digest of each code and expires unused
codes. An operator issues codes with the server-only `ENROLLMENT_ADMIN_KEY`;
both that value and the separate `ENROLLMENT_INVITE_KEY` digest key belong only
in the Convex deployment environment. Never place either in a `VITE_*` value,
Netlify build setting, client code, ticket, or email body.

Set the required Resend, Turnstile, callback, and signing-key configuration
before deployment. The exact value-free names and secret-store boundaries are
documented in [the security policy](../docs/SECURITY.md#required-deployment-configuration).
Do not store job-board passwords, browser cookies, real resumes, or application
answers in Netlify environment variables.

## Current product scope

The web app supports account registration, sign-in, isolated job pipelines,
manual role creation, role search, and status tracking. The local Career-Ops
scanner remains separate from the Convex dataset; automated discovery, document
generation, browser-assisted form filling, and application submission are not
implemented in this deployment.

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
