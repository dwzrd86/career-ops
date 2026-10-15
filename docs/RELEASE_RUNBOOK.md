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

- Inspect the production release inputs without deploying or changing settings:

  ```bash
  cd web
  npm run release:preflight -- \
    --expected-convex-url https://beaming-bass-637.convex.cloud \
    --check-convex-env
  ```

  The preflight checks Node 24, the reviewed CSP, required build-setting
  presence in the current process, the local development URL denylist,
  optional endpoint overrides, and existing bundle endpoints. The optional
  Convex audit requests **names only** from the explicitly named deployment;
  it never fetches secret values. Missing settings or an unavailable provider
  fail the check. Output contains only fixed diagnostics and variable names.
  A local missing build setting does not establish whether Netlify has it:
  run in the production build environment or review Netlify's names/scopes
  separately. This is a preflight, not deployment authorization or proof that
  secret values, sender verification, site-key hostnames, or accounts work.
  A stale/missing dist failure requires a fresh guarded production build.
- Node.js 24 is installed.
- The source-only change set passes the `Web Release Safety` GitHub workflow.
- The security release gate passes from `web/` before the deploy or release tag:

  ```bash
  npm ci --ignore-scripts
  npx playwright install chromium
  npm run test:security-regression
  ```

  This is also required by the release workflow before Release Please can
  create a release tag.
- Netlify has a production `CONVEX_DEPLOY_KEY` in its secret store and
  `CONVEX_DEV_DEPLOYMENT_URLS` lists every known development Convex URL.
- The deploy key targets the intended Convex production deployment.
- Review the local discovery boundary before enabling or changing any recurring
  scheduler: `data/autodiscovery/`, `data/autodiscovery-backups/`, and
  `data/autodiscovery-exports/` must be ignored and absent from the release
  change set. Confirm retention and encrypted-backup ownership locally; do not
  attach those records, browser profiles, or local exports to a deployment.
- If a future explicit worker bridge is introduced, its credential has an
  identified owner, is stored outside Git and systemd unit files, and has a
  tested revocation/rotation procedure. This release has no worker token.
- Convex warning and disable limits have been approved for the alpha budget;
  verify them without printing any credentials:

  ```bash
  cd web
  npx convex deployment usage-limits list --deployment beaming-bass-637
  ```

  Confirm in the Convex dashboard that warning notifications reach the current
  technical owner and backup administrator. The CLI verifies configured limits;
  recipient delivery is a provider-dashboard check.

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

Run the release smoke test before marking the deploy ready. It validates the
anonymous SPA shell, enforced security headers, entry-document and immutable
asset caching, the single bundled Convex endpoint, an anonymous browser route,
and both isolated browser workflows. The live CSP must match the reviewed
policy in `netlify.toml` (directive/source order and whitespace may differ),
and that policy must allow the expected production Convex HTTPS, WebSocket,
and HTTP-action origins. Missing, additional, stale, or duplicate directives
fail the gate. The compiled fixture runs with the actual
enforced CSP from `netlify.toml` and proves that unauthorized connections are
blocked. Account persistence and Turnstile responses in these workflows are
mocked; verify real hosted sign-in and discovery separately.

For a focused preflight without a release or provider call:

```bash
npm run test:browser-csp
```

This compiles disposable fixture assets under ignored `agent/.local/`; it does
not replace `web/dist`. The full security regression also builds and verifies
its synthetic endpoint in a unique directory under `agent/.local/`, then
removes that directory even when a check fails. It preserves `web/dist`.
An existing dist directory is not evidence of a valid release: older test runs
may have left a synthetic build there. Always run the production guarded build
for the intended deployment before publishing.

```bash
cd web
npm run release:smoke -- \
  --site https://your-site.example \
  --expected-convex-url https://your-production-deployment.convex.cloud
```

Do not use `--skip-browser` for a production release. That flag exists only
for narrow local diagnostics.

## Local scheduler emergency stop

For an unexpected collection run, source failure that could expose data, or a
lost dedicated browser context, stop the local scheduler before changing a web
deployment:

```bash
npm run scheduler:status -- --kill-switch on
npm run scheduler:systemd -- uninstall
```

Verify the timer is inactive with `npm run scheduler:systemd -- status`. Do not
export browser cookies or tokens to restore the context. Recover with a new
dedicated context, a manually reviewed HTTPS allowlist, and one successful
manual metadata-only run; see [[INCIDENT_RESPONSE]].

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
