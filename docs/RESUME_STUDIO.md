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

Select a role to restore its saved bundle. The source resume is kept separately from the editable draft. Start draft from source copies that evidence into the editor; it does not generate qualifications. Save bundle stores source resume, pasted job description, draft, revision, and review timestamp in the signed-in owner's Convex account. Unsaved edits remain in memory and clear on refresh or sign-out. Switching roles with unsaved changes requires confirmation, and leaving the page raises the browser's unsaved-changes prompt.

Every content edit clears factual approval. Review status persists with a save. Conflicting saves or deletes from another tab are rejected using the expected revision. Export or otherwise preserve unsaved edits before reloading after a conflict. Each account can retain 50 bundles, one per pipeline role, with 40,000 characters per text field. Delete saved bundle removes the server copy while leaving editor text unsaved; removing the pipeline job and deleting the account also remove saved bundles. The account JSON export includes bundle evidence and drafts. [[PRIVACY]] documents this changed boundary and the in-app notice requires acknowledgement of its new version before saving.

## Next iteration

Implement GLM tailoring with existing career-ops factual verification/tailoring utilities. Z.ai's [current Coding Plan policy](https://docs.z.ai/devpack/usage-policy), checked 2026-10-14, limits subscription use to supported tools. A custom hosted backend is not confirmed supported. Verify a supported integration before using the Coding Plan; do not silently substitute a paid general API or send resume content to a provider. This iteration adds no AI calls and requires no provider credential.

The development backend can be verified independently of the public web release. Do not describe local or development checks as a production release. GitHub pushes currently fail with a permission error for the configured origin.

## Verification

`npm run build:app` checks TypeScript and builds the UI. `npm run test:browser-flow` exercises selection, keyword evidence, factual review gating, exact text download, print layout, review reset after editing, sign-out draft clearing, and mobile overflow alongside the existing account and discovery flow. The expanded browser flow also checks save, role switching, restore after sign-in, review invalidation, and deletion. `npm run test:authorization` checks cross-account isolation, optimistic conflicts, input limits, bundle exports, and cascaded job/account deletion. These are isolated checks with fictional career data.


## Iteration 2 handoff

Saved per-role bundles are implemented in `web/convex/resumeBundles.ts` and
`web/src/ResumeStudio.tsx`. The full working tree passed app build/typecheck,
19 isolated backend tests, and the expanded browser flow. `convex dev --once`
successfully verified the configured development deployment
`third-wolverine-369`; this is not a public frontend release. The repo still
contains substantial prior uncommitted Target Profile/discovery changes.
This iteration staged its own changes separately; preserve that remaining work.

Next prioritize a supported GLM integration and factual tailoring, then make
the complete web experience available for tonight's job search. Do not mistake
manual editing and saved drafts for automated, ATS-ready generation. Confirm
Coding Plan support for the chosen integration using current provider docs;
no provider keys were read or printed and no AI request was made here.
