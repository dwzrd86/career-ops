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

Career-Ops contains a local, personal job-search workspace alongside a
source-controlled web application. Keep those boundaries explicit.

## Data classification

| Classification | Examples | Handling |
| --- | --- | --- |
| Public source | Application code, generated Convex bindings, tests, deployment configuration, non-personal documentation | May be reviewed and committed after the secret scan. |
| Private career records | `cv.md`, `article-digest.md`, `data/`, `reports/`, `config/profile.yml`, `portals.yml`, writing samples | Keep local and ignored. Never paste into an issue, commit, demo, or test fixture. |
| Secrets and access material | `.env*`, Netlify and Convex tokens/deploy keys, generated `.convex-home/` credentials, browser profiles | Keep outside Git and logs. Use provider secret stores and rotate if exposed. |
| Test identities | Production test accounts, real email inboxes, job-board credentials | Do not create or commit them. Use isolated, disposable test identities only when necessary. |

## Secret-handling rules

- Never print, commit, or copy secret values into source files, CI output, shell history, screenshots, or tickets.
- Keep `.env*`, `.convex-home/`, `.netlify/`, browser automation profiles, and all personal records ignored.
- Commit `web/.env.example` only as a value-free template.
- Grant Netlify only the Convex production deploy key it needs; do not use personal access tokens in build settings.
- Treat a suspected exposure as a rotation event: revoke the credential, issue a replacement, and review deployment access.

## Supported deployment flow

The only supported production path is documented in [[RELEASE_RUNBOOK]]. Netlify
runs `npx convex deploy --cmd 'npm run build'`, which supplies the
production `VITE_CONVEX_URL` to the build. The build guard rejects a known
development URL and checks the emitted bundle contains only the expected
production Convex endpoint before Netlify publishes `dist/`.

Do not run a standalone frontend publish or manually substitute a Convex URL.
Use the CI workflow and the release runbook before deploying.
