---
type: reference
title: Career-Ops Web Release Runbook
created: 2026-08-01
tags:
  - release
  - netlify
  - convex
related:
  - '[[SECURITY]]'
  - '[[ARCHITECTURE]]'
---

# Career-Ops web release runbook

Use this runbook for a production release of `web/`. Do not include personal
career files or credentials in a release branch or deployment.

## Preconditions

- Node.js 24 is installed.
- The source-only change set passes the `Web Release Safety` GitHub workflow.
- Netlify has a production `CONVEX_DEPLOY_KEY` in its secret store and
  `CONVEX_DEV_DEPLOYMENT_URLS` lists every known development Convex URL.
- The deploy key targets the intended Convex production deployment.

## Release

From `web/`, install the lockfile dependencies and run the guarded Convex build:

```bash
npm ci --ignore-scripts
npx convex deploy --cmd 'npm run build'
```

The command deploys Convex functions, supplies `VITE_CONVEX_URL` to the build,
and refuses to produce a bundle with a listed development deployment URL. It
also verifies `dist/assets/*.js` contains only the expected production endpoint.

After that succeeds, publish exactly that verified directory without rebuilding:

```bash
netlify deploy --no-build --dir=dist --prod
```

Copy the resulting production URL and verify that the deployed JavaScript bundle
references the expected production Convex endpoint. Replace the placeholders
locally; do not record private URLs or tokens in this document.

```bash
curl --fail --silent --show-error https://your-site.example/ > /tmp/career-ops-release.html
curl --fail --silent --show-error https://your-site.example/assets/your-bundle.js | grep -F 'https://your-production-deployment.convex.cloud'
```

Determine the current asset path from the first response before issuing the
second command. A missing expected endpoint or an unexpected Convex endpoint is
a failed release: stop and roll back.

## Rollback

1. In Netlify Deploys, select the last known-good published deploy and use
   **Publish deploy** to restore it. This restores the static frontend quickly.
2. In the Convex dashboard deployment history, identify the last known-good
   production deployment. Use the provider's rollback/redeploy control for that
   deployment, or redeploy the corresponding reviewed Git commit with
   `npx convex deploy --cmd 'npm run build'`.
3. Repeat the bundle endpoint check above and record the incident outside the
   repository without including credentials or personal career records.

See [[SECURITY]] for the data classification and credential-handling rules.
