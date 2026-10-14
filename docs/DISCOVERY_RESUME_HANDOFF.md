---
type: reference
title: Discovery to Resume Studio handoff
created: 2026-10-14
tags:
  - discovery
  - resume
  - verification
related:
  - '[[RESUME_STUDIO]]'
  - '[[SECURITY]]'
---

## Delivered this iteration

Approve for evaluation now atomically adds a discovered role to the signed-in
owner's pipeline. Choose that company and title in Resume Studio to begin
tailoring. It carries company, title, location, posting URL, and source.
Missing locations display Not specified. Posting text must still be pasted
from the original posting; approval does not claim that a role is verified live.

The owner-and-URL index prevents repeated approvals from creating another role.
An existing manual role at the same URL is reused. Existing application status,
notes, and saved resume bundles stay intact. Identical URLs in another account
remain separate. Repeated approval does not add another approval history event.
Approval creates no employer submission and performs no AI request.

## Verification

Six authorization tests passed, including approval isolation, anonymous rejection,
missing-location fallback, repeat approval, preserved applied status and saved
resume, and manual-role deduplication. The isolated browser workflow selected an
approved discovery in Resume Studio and checked repeated approval produced only
one target. Its existing GLM fixture, factual review, DOCX/text export, save/restore,
sign-out, and mobile checks passed. TypeScript and Vite production build passed.

Convex dev --once accepted the new jobs.by_owner_url index on development
third-wolverine-369. This checks the complete working tree, including prior
uncommitted discovery/auth changes; it is not a production frontend release.

## Remaining work

The configured GitHub account is dwzrd86 and the nested app origin is
https://github.com/dwzrd86/career-ops.git on feat/autodiscovery-target-profile.
This iteration stages only its own changes. Preserve the substantial pre-existing
uncommitted discovery, Target Profile, and authentication work.

Next verify approved public feeds with actual current postings, then exercise
real discovery through matching and GLM generation to document export. Keep
real source resume data local unless explicitly sent through the user's
configured OpenCode Coding Plan integration. The hosted GUI still needs release
and verification, and hosted GLM generation is not implemented. Main has diverged;
inspect before any integration and never force-push.

Jobbie's public site advertises upload-once resume setup, role matching, resume
tailoring, and application tracking (https://jobbie.bot/, checked 2026-10-14).
The next product improvement should reduce repeated source-resume and posting
entry while retaining factual review and visible matching reasons.
