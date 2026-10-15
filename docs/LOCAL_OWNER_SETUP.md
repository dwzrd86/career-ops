---
type: reference
title: Local first-owner setup
created: 2026-10-14
tags:
  - local-development
  - authentication
related:
  - '[[SECURITY]]'
  - '[[RESUME_STUDIO]]'
  - '[[RELEASE_RUNBOOK]]'
---

The personal development dashboard supports creating its first owner with an
email identifier and a password, without Resend, Turnstile, or an alpha invite.
Open http://127.0.0.1:5174/, select **Create an account**, enter an email and a
password of 12–128 characters containing a letter and number, and confirm it.
The account signs in through the normal Better Auth password flow. Review the
privacy notice before storing career data. Later visits use **Sign in**.

This is operator-authorized local identity setup, not proof of email ownership.
The owner record is marked verified so the existing authorization and enrollment
checks work unchanged. Keep the password safe: email recovery is unavailable
until a real mail provider is configured. Password changes using the current
password remain available. Career records are still stored privately in the
configured Convex development deployment, not solely on the laptop.

The backend requires `AUTH_LOCAL_OWNER_SETUP=dev:<deployment-name>`, a matching
built-in `CONVEX_SITE_URL`, a loopback HTTP `SITE_URL`, and the existing
`ENROLLMENT_ADMIN_KEY`. The Vite service receives the operator key as
`CAREER_OPS_OWNER_ADMIN_KEY` and deployment cloud URL as
`CAREER_OPS_OWNER_CONVEX_URL`. Never use a `VITE_` variable for the operator key.
The current service reads an owner-only ignored environment file at
`agent/.local/owner-service.env`. Its unit is `career-ops-local.service`.

The development middleware requires a loopback connection, matching Host/port,
same-origin POST, custom header, JSON content type, and a bounded body. It
forwards credentials over HTTPS to the guarded backend action without logging
them or returning the operator key. A transactional reservation and account
creation check enforce one owner, including competing attempts. Existing
accounts close setup; use normal sign-in. No production signup gate was removed.
The middleware is absent from production builds. Production still requires the
normal invite, verified email, bot protection, and account configuration.

Verification covers missing/wrong operator keys, public origins, deployment
mismatch, reservation exclusivity, verified account creation and enrollment,
second-account refusal, middleware origin/header/body checks, and the existing
backend authorization suite. A browser check of the actual local dashboard
confirmed the invite/bot controls are absent and Create account is enabled.
That browser check did not create the user's account.
