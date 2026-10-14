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

Resume Studio is available in the authenticated web dashboard. Choose a pipeline role, paste the original posting and resume text, edit the resume, acknowledge factual review, and download Word (.docx), plain text, or use the browser print dialog to save PDF. Disable browser headers and footers in the print dialog.

The PDF layout contains only resume text in one column, with selectable text and standard typography. This does not guarantee acceptance or ranking by a particular ATS. Common-skills coverage is a literal checklist, not a match score or an exhaustive requirements analysis. No experience or qualifications are generated.

Select a role to restore its saved bundle. The source resume is kept separately from the editable draft. Start draft from source copies that evidence into the editor; it does not generate qualifications. Save bundle stores source resume, pasted job description, draft, revision, and review timestamp in the signed-in owner's Convex account. Unsaved edits remain in memory and clear on refresh or sign-out. Switching roles with unsaved changes requires confirmation, and leaving the page raises the browser's unsaved-changes prompt.

Every content edit clears factual approval. Review status persists with a save. Conflicting saves or deletes from another tab are rejected using the expected revision. Export or otherwise preserve unsaved edits before reloading after a conflict. Each account can retain 50 bundles, one per pipeline role, with 40,000 characters per text field. Delete saved bundle removes the server copy while leaving editor text unsaved; removing the pipeline job and deleting the account also remove saved bundles. The account JSON export includes bundle evidence and drafts. [[PRIVACY]] documents this changed boundary and the in-app notice requires acknowledgement of its new version before saving.

## GLM handoff (iteration 3)

Resume Studio now provides **Download GLM brief** after selecting a role and
supplying a source resume and job description. The downloaded text contains
factual tailoring instructions and JSON-encoded evidence. The instructions
reuse the established `modes/pdf.md` approach: prioritize relevant proof points,
rewrite concisely, and never invent qualifications or metrics.

Open the brief in your own GLM-configured supported agent, save the returned
resume as a UTF-8 `.txt` file, then use **Import tailored draft**. This is a
manual handoff, not an automated backend. The dashboard does not access a
provider key or make model requests. Sharing the brief with an external agent
shares its resume and posting content with that agent's provider. The downloaded
file is not covered by private account deletion; handle it as personal data.

The import rejects empty, binary, corrupt, and oversized files; replacing a
draft requires confirmation. Importing clears factual approval. Expand the
changed-lines comparison to inspect claims against the source; new literal
skills are highlighted. These checks do not establish truth or guarantee that
a model obeyed the prompt. Existing manual edits, per-role saves, and export
review gating still apply.

[Z.ai's supported-tool list](https://docs.z.ai/devpack/tool/others), checked
2026-10-14, now includes general-purpose agents such as OpenClaw and Hermes.
It explicitly limits subscription use to its supported tools and scenarios.
A custom Convex backend remains outside the documented supported scope. No
paid API fallback was added and no real resume was sent to an AI provider.

## Next iteration

Implement GLM tailoring with existing career-ops factual verification/tailoring utilities. Z.ai's [current Coding Plan policy](https://docs.z.ai/devpack/usage-policy), checked 2026-10-14, limits subscription use to supported tools. A custom hosted backend is not confirmed supported. Verify a supported integration before using the Coding Plan; do not silently substitute a paid general API or send resume content to a provider. This iteration adds no AI calls and requires no provider credential.

Next automate the handoff through an actual supported general-purpose agent
with an explicit local integration, after confirming its setup and data-sharing
boundary. A prompt export alone does not meet the requested automatic tailoring
experience. The public frontend still needs a verified release; discovery and
Target Profile changes remain pre-existing work in the working tree.

The development backend can be verified independently of the public web release. Do not describe local or development checks as a production release. GitHub pushes currently fail with a permission error for the configured origin.

## Local OpenCode generation (iteration 5)

`web/scripts/tailor-resume.mjs` automates the brief-to-draft step through
OpenCode. Requires Node 22.18+ for the shared TypeScript validators, and an
installed OpenCode version supporting `run --pure --format json --file`.
Authenticate using `opencode auth login`, selecting **Z.AI Coding Plan**.
Use `/models` in OpenCode to find the desired model ID. From `career-ops`:

```bash
node web/scripts/tailor-resume.mjs --brief "path/to/downloaded-glm-brief.txt" --out "output/resume.txt" --model "zai-coding-plan/YOUR-MODEL-ID"
```

This validates locally without calling a provider. Add `--send-to-glm` to
send the source resume and posting through OpenCode and generate the draft.
The output directory must exist inside career-ops; choose a new filename for
each result. Import that file using **Import tailored draft**, compare it
against the source, review the facts, and export the Word document or PDF.

The runner rebuilds the canonical factual instructions from the brief's JSON,
reuses the UI's draft validation, and pins the `zai-coding-plan` provider with
no general API fallback. A custom primary agent denies all tools; plugins and
public session sharing are disabled. Briefs are attached from a private
temporary directory under ignored `agent/.local/resume-runs`, rather than
placed in command arguments. Temporary attachments are removed after the run.
Output uses exclusive creation and owner-only permissions. Provider logs are
not printed; failed, incomplete, oversized, tool-using, or fenced responses
do not create a draft. The default timeout is three minutes.

OpenCode still uses its own credential store and local session history, and
loads its normal configuration. Run with a trusted OpenCode setup; these
permission settings are not an OS sandbox. Dashboard account deletion does
not delete downloads, generated files, or OpenCode history. The user must
still review every generated claim; format validation cannot establish truth.

This is an explicit local agent workflow, not a custom hosted Coding Plan
API or one-click dashboard backend. Z.ai's
[OpenCode guide](https://docs.z.ai/devpack/tool/opencode) documents the
Coding Plan provider and its [usage policy](https://docs.z.ai/devpack/usage-policy)
limits subscription use to supported tools (checked 2026-10-14). OpenCode's
[CLI](https://opencode.ai/docs/cli/),
[configuration](https://opencode.ai/docs/config/), and
[permissions](https://opencode.ai/docs/permissions/) document the runner's
flags and provider/tool restrictions. No live provider request or credential
inspection was performed in this iteration.

Verification includes a fake OpenCode executable exercising subprocess
arguments, private attachment transport, restricted configuration, Unicode,
timeouts, failures, cleanup, and non-overwrite behavior:
`node --test web/scripts/tailor-resume.test.mjs`. Build, resume tests,
authorization tests, and the isolated browser flow also passed.

Next verify generation with the user's configured Coding Plan agent, reduce
the remaining manual dashboard handoff, and deliver a verified frontend
release. Preserve pre-existing uncommitted discovery/Target Profile changes.

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

## Iteration 3 handoff

GLM brief download, UTF-8 draft import, changed-line comparison, and new literal
skill warnings are implemented in `web/src/ResumeStudio.tsx` and
`web/src/resumeTailoring.ts`. Verification: app typecheck/build, four tailoring
unit tests (`npx vitest run --config vitest.resume.config.ts`), five authorization
tests, and the expanded isolated browser flow. The browser confirmation test
now waits for each dialog to finish before attaching the next handler.

No deployment or provider request was made. The actual nested repo branch is
`feat/autodiscovery-target-profile`; preserve the pre-existing uncommitted work.
The origin push again failed with 403 for `kascadeceo`. Next deliver a supported
agent integration and verify a public frontend release, rather than treating
this manual handoff as completion of automatic tailoring.

## Iteration 4 handoff

**Download Word** creates an actual DOCX in the browser after factual review.
It preserves the reviewed text and line order, including Unicode, in ordinary
paragraphs with Arial typography and US Letter margins. It adds no tables,
text boxes, graphics, external links, job-description text, or generated claims.
Document packing loads on demand. The export requires review again after any
content edit; signing out while an export is preparing cancels its download.
Choose the file format requested by each employer. A simple document format
does not guarantee acceptance or ranking by any ATS.

Implemented in `web/src/resumeDocument.ts` and `web/src/ResumeStudio.tsx`.
The new DOCX tests extract `word/document.xml` to check Unicode evidence and
reading order, invalid-input rejection, and retention of long drafts. The
isolated browser flow verifies the downloaded archive and review gating.
Verification passed: app TypeScript/build, six resume unit tests, five backend
authorization tests, and the complete isolated browser flow. A clean-install
dry run also validated the staged dependency manifests independently of the
pre-existing uncommitted dependency changes.

Z.ai's [OpenCode integration](https://docs.z.ai/devpack/tool/opencode) documents
the separate **Z.AI Coding Plan** provider. OpenCode is installed locally;
OpenClaw and Hermes executables were not found. The
[supported-tool scope](https://docs.z.ai/devpack/tool/others) and
[usage policy](https://docs.z.ai/devpack/usage-policy), checked 2026-10-14,
still do not establish custom hosted-backend support. No credentials were
read, provider requests made, or deployment performed. The next iteration
should resolve a supported agent workflow and public release. Preserve the
pre-existing discovery/Target Profile work and do not substitute paid API use.
