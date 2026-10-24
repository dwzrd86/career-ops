---
type: reference
title: Meritwake beta testing guide and current release limits
created: 2026-10-24
tags:
  - beta
  - onboarding
  - verification
related:
  - '[[LOCAL_OWNER_SETUP]]'
  - '[[RESUME_STUDIO]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[MERITWAKE]]'
---

# Test one complete application

The current local development app is at http://127.0.0.1:5174/. Its user service
is `career-ops-local.service`; a machine reboot can require starting the service
again. The beta website has not been republished by this change. Use your normal
account password; first-owner setup is available only while no account exists.
The updated privacy notice requires acknowledgement again before saving data.

1. Open **Create an account** if you are the first local owner, otherwise **Sign
   in**. Policies are readable inside the app before signup and after sign-in.
2. Follow **Your first application**. Choose Target Profile or **I already have
   a job to add**. A direct employer link is a valid starting point for any role.
3. For discovery, enter target titles and location, explicitly enable discovery,
   save, and select **Run now**. Optional salary, eligibility, and exclusions are
   expandable. New and imported profiles default to manual, disabled discovery;
   importing a profile never silently opts into recurring collection.
4. Review a discovered role before approving it, or add a real posting yourself.
   Public feed coverage is limited. An empty feed result is not a conclusion
   about the job market or your suitability.
5. Select **Prepare resume**. Import your original `.txt`/`.md` resume, reuse a
   saved source, or paste text from PDF/Word. Confirm the job description.
6. Use local GLM if connected and after acknowledging sharing; otherwise edit
   manually or import a draft. A missing AI connection is explicitly shown.
7. Optionally enter role-specific checklist terms, one per line, for any
   profession. These are temporary checks, reset on role change/refresh and
   excluded from saved bundles/AI briefs. They are not credential verification,
   an ATS score, or evidence that a required skill is held.
8. Compare the draft against the source, review the facts, save the bundle, and
   download Word/text or print to PDF. Editing draft/evidence or changing the
   review checklist clears factual approval. No employer application is submitted.
9. Reload and select the same role: confirm the saved evidence, draft and review
   state return. The guide reflects saved state; unsaved edits are not progress.
10. Use **Beta help** for instructions and a privacy-safe feedback template.
    Send feedback through your invitation contact. The template sends nothing
    automatically and contains no account identity, resume or provider errors.

## What changed in this update

- Meritwake/Fieldnotes identity is applied to the actual UI, favicon, page title,
  export metadata and auth email subjects. Technical deployment/database IDs and
  historical tooling names remain stable.
- A saved-progress guide links to the next meaningful action and honors existing
  unsaved-change protection. Mobile help remains accessible from the top bar.
- Signup reports missing configuration and failed/expired bot checks, with a
  retry that preserves typed form fields. Hosted registration still requires
  proper provider configuration; this update adds no bypass.
- Searching for a nonexistent role shows a clear-search action rather than
  suggesting that the entire pipeline is empty.
- The current privacy, terms and security contact text is bundled into native
  dialogs. This avoids stale/private GitHub links, unsafe raw HTML, and inherited
  upstream contact addresses. The invitation contact is the interim beta channel;
  a monitored public support address remains a release requirement.
- Dependency fixes: Vite 6.4.5, Vitest 4.1.12 and transitive Zod 4.6.7. The
  dependency audit reports zero vulnerabilities after compatible updates.

## Verification and evidence

Node 24 full security regression passed all ten checks: dependency audit,
backend tests, build guard, release preflight, guarded build and bundle endpoint,
security headers, enforced-CSP browser workflow, release smoke regressions,
and isolated browser workflow. The app build/typecheck and ten resume/export
unit tests passed. The browser flow verifies onboarding focus/progress, bot
failure/retry, bundled policies, custom checklist limits, empty-search recovery,
feedback modal, saved bundles, review/print/export gating, sign-out, and mobile
overflow. Browser account persistence and generation are fictional fixtures;
they do not establish actual hosted registration or real provider generation.

Only development `third-wolverine-369` received the backend subject/version
update. No production deployment, employer submission, or paid inference request
was made. The app-build dist directory is not a certified production artifact;
use the guarded release runbook before any publication.

## Hosted beta work still required

Follow [[RELEASE_RUNBOOK]] and the existing beta Auto Run plan to verify the
actual Resend sender, Turnstile hostname, email recovery, exact frontend/backend
targets, real two-account isolation, and public release smoke. Shared hosted GLM
or approved Claude generation and atomic budget reservations are not connected
in this build. The $10/month API ceiling remains a requirement, not a newly
implemented billing guarantee. Do not enable a paid shared provider until its
usage ledger, limits, credentials and synthetic live checks are ready.

General profession-specific terms are supported, but no broad-profession job
coverage, license/credential verification, government resume format, academic
CV format or guaranteed ATS compatibility is claimed.
