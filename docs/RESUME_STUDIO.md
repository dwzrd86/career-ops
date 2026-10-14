---
type: reference
title: Resume Studio implementation and next steps
created: 2026-10-14
tags:
  - career-ops
  - resume
related:
  - '[[SECURITY]]'
  - '[[PRIVACY]]'
---

Resume Studio is available in the authenticated web dashboard. Choose a pipeline role, paste the original posting and resume text, edit the resume, acknowledge factual review, and download plain text or use the browser print dialog to save PDF. Disable browser headers and footers in the print dialog.

The PDF layout contains only resume text in one column, with selectable text and standard typography. This does not guarantee acceptance or ranking by a particular ATS. Common-skills coverage is a literal checklist, not a match score or an exhaustive requirements analysis. No experience or qualifications are generated.

Draft content lives only in React state, is never sent to Convex or an AI provider, and is cleared on refresh or sign-out. Download before leaving. This session-only behavior is intentional until the saved-document data and privacy design is implemented.

## Next iteration

Integrate the requested GLM Coding Plan through its documented server-only endpoint, after confirming current plan support for this use. Reuse existing career-ops tailoring and factual verification logic. Add per-role document bundles with original evidence, generated drafts, factual review, and downloadable PDF files. Extend the privacy notice before sending resumes to a provider. Do not expose provider credentials in browser environment variables.

## Verification

`npm run build:app` checks TypeScript and builds the UI. `npm run test:browser-flow` exercises selection, keyword evidence, factual review gating, exact text download, print layout, review reset after editing, sign-out draft clearing, and mobile overflow alongside the existing account and discovery flow. These are isolated checks; no deployed backend or real resume is involved.
