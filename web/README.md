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
