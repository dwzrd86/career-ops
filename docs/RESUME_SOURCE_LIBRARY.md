---
type: reference
title: Reusable source resume library
created: 2026-10-14
tags:
  - resume
  - privacy
  - verification
related:
  - '[[RESUME_STUDIO]]'
  - '[[DISCOVERY_RESUME_HANDOFF]]'
---

## Delivered

Resume Studio offers “Reuse saved source resume.” Save one completed bundle,
then choose its original evidence when preparing another role. The picker labels
sources by company and role, removes exact duplicates, and lists the most recently
saved representative first. It copies original evidence, not the generated draft.
Existing source text requires confirmation before replacement. Reuse resets factual
review, leaves the role-specific draft and posting intact, and marks unsaved edits.
No automatic provider request or new browser storage is introduced.

The query requires a verified, enrolled account and uses the existing owner index.
The 50-bundle cap bounds reads. Job ownership is checked again before returning
source text. Removing bundles or jobs removes their sources from the live picker;
existing account deletion already erases all resume bundles.

## Verification

Seven authorization tests passed, including source isolation, anonymous rejection,
deduplication, newest-source ordering, and deletion. The isolated browser flow
reused saved evidence in an approved discovery role and checked its draft and
posting stayed empty and export required review. Existing GLM fixture generation,
factual warnings, bundle persistence, DOCX/text export, and mobile checks passed.
TypeScript and Vite production build passed. Development third-wolverine-369
accepted the query through convex dev --once.

The full authentication/backend suite initially exposed a stale discovery test
expecting approval to create no pipeline role. Its expectation now verifies both
the manual and approved roles and confirms another account has no pipeline roles.
The full suite then passed: 21 tests across five files.

## Next iteration

The active
account is dwzrd86; origin is https://github.com/dwzrd86/career-ops.git and branch
is feat/autodiscovery-target-profile. Keep prior uncommitted discovery/profile/auth
work separate. No main integration or production release occurred this iteration.

Next prioritize current public-feed discovery through matching, actual GLM draft,
and ATS export. Posting descriptions still require entry. Hosted GLM generation
and release verification remain outstanding, so the overall goal is incomplete.
