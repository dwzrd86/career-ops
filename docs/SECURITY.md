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

## Account lifecycle decision

**Decision (2026-08-01): retain Convex Auth `@convex-dev/auth` `0.0.94` and
add a Resend-backed, Auth.js-compatible transactional email provider for
password reset and address verification.** Version `0.0.94` is the current
npm release as of this review. The official Convex Auth password guidance
supports both flows through the `Password` provider's `reset` and `verify`
options, and keeps identity policy and the registered HTTP routes in
`web/convex/auth.ts` and `web/convex/http.ts` respectively. The implementation
will use opaque, single-use verification and reset values; users may not read
or write pipeline data until verification succeeds.

This is an invited-alpha decision, not an assertion that Convex Auth is
generally equivalent to a full identity platform. Convex currently documents
Convex Auth as beta, so upgrade compatibility and the account-lifecycle tests
must be reviewed before every production release. The current application is a
React/Vite single-page application, which is a supported Convex Auth target.

### Why this is supported

- [Convex Auth's current overview](https://docs.convex.dev/auth/convex-auth)
  explicitly lists passwords with reset and optional email verification.
- [The password-provider guide](https://labs.convex.dev/auth/config/passwords)
  documents `reset` and `verify` provider configuration, including a Resend
  implementation, and identifies the corresponding sign-in flows.
- [Convex's authentication overview](https://docs.convex.dev/auth/overview)
  confirms that backend functions remain responsible for authorization checks;
  the implementation will therefore add a verified-identity guard to each
  public pipeline function rather than relying on the React screen alone.

### Migration impact

- Keep the existing Convex Auth tables and `jobs.ownerId -> users` references;
  no user-data table migration is required solely to add the providers.
- Extend `web/convex/auth.ts` with the shared email normalization and the
  `Password({ verify, reset, ... })` configuration; retain the present 12
  character, letter-and-number password requirement.
- Add a mail adapter and required deployment configuration. Production must
  fail closed if the sender identity or mail credential is absent. Do not put
  mail credentials in `web/.env.example`, source control, browser code, or
  logs.
- Existing password accounts must be treated as unverified until they complete
  the verification flow. Their job documents remain owned by the same user ID,
  but are inaccessible until verification; exercise this path in a disposable
  deployment before release.
- Preserve `auth.addHttpRoutes(http)` in `web/convex/http.ts`; add only the
  documented routes/provider handlers needed for the chosen flows. The React
  app will gain sign-up verification, resend, reset request, and reset
  completion states.

### Rejected alternatives

| Alternative | Decision rationale |
| --- | --- |
| Leave the current password-only flow | Rejected: it has neither recovery nor verified ownership of the email address. |
| WorkOS AuthKit | Rejected for this invited alpha: it is a viable mature OIDC option with passwords, email one-time codes, MFA, and user management, but would replace the existing auth provider, change the React integration and Convex JWT configuration, and require an identity migration. Reconsider if beta-library risk, enterprise SSO, or provider-managed MFA becomes a requirement. |
| Clerk or Auth0 | Rejected for the same release: both are supported by Convex and offer broader managed identity features, but introduce vendor configuration, new browser/provider components, JWT issuer configuration, and user/account migration without solving a requirement unavailable in the documented Convex Auth path. |

The selected implementation does not remove the future OIDC option: job
authorization will continue to use authenticated identity plus verified-email
state, never a client-supplied email address or a browser-visible auth table.
