# Manual Application Checklist — DRAFT ONLY

> **Draft status:** `draft-awaiting-review`. This bundle is preparation material,
> not an application. A person must review every item and personally interact
> with the employer's application page.

## Bundle provenance

| Field | Value |
|---|---|
| Company / role | `{company} — {role}` |
| Prepared at | `{createdAt}` |
| Evaluation report | `{reportPath}` |
| Resume / PDF draft | `{pdfPath}` |
| Source snapshot | `{normalizedJdSnapshot.localPath}` (`sha256: {normalizedJdSnapshot.sha256}`) |
| Target Profile version | `{targetProfileVersion}` |
| Evidence register | `{evidenceReferences}` |

Keep the source snapshot, Target Profile version, and evidence register with
every regenerated draft. Do not replace these values with a newer source or
profile without making a new bundle.

## Evidence-backed claim register

Every resume bullet, cover-letter sentence, outreach sentence, and application
answer must have at least one explicit evidence reference. Use the stable
reference from the bundle's Evidence register (for example,
`resume:cv.md#experience-2`), not an unsupported recollection.

| Material | Draft claim | Evidence reference(s) | Review status |
|---|---|---|---|
| Resume | `{claim}` | `{kind}:{reference}` | `draft — reviewer must verify` |
| Cover / outreach | `{claim}` | `{kind}:{reference}` | `draft — reviewer must verify` |
| Application answer | `{claim}` | `{kind}:{reference}` | `draft — reviewer must verify` |

If an evidence reference cannot be supplied, remove the claim or move it to
**Unresolved gaps**. Never turn a gap into a credential, metric, or experience
claim.

## Draft answers — review before copy/paste

### [DRAFT] `{exactQuestion}`

`{draftAnswer}`

**Evidence:** `{kind}:{reference}`

Repeat this block for every answer. All answers remain drafts until the
candidate approves them; no tool, script, or browser automation may enter them
into an employer form.

## Unresolved gaps and decisions

| Gap or unknown | Why it matters | Evidence checked | Candidate decision needed |
|---|---|---|---|
| `{gap}` | `{impact}` | `{references}` | `{decision}` |

List missing experience, authorization, compensation, availability, work
location, and unanswered form questions here. Do not infer answers.

## Human review

- [ ] I reviewed the report, resume/material drafts, and every claim reference.
- [ ] I verified the source snapshot and Target Profile version are still the
      intended versions.
- [ ] I resolved, removed, or explicitly accepted every listed gap.
- [ ] I approved only the draft answers I want to use.
- [ ] I will manually copy approved text into the employer's form.
- [ ] I will personally choose any dropdowns, upload any approved files, and
      review the completed form.
- [ ] I will personally decide whether to submit; this system never fills a
      page, uploads a file, clicks submit, or submits an application.

## Final manual record (optional)

| Field | Candidate-completed value |
|---|---|
| Candidate reviewed at | `{manualReviewAt}` |
| Candidate-approved materials | `{approvedMaterials}` |
| Candidate-submitted at | `{manualSubmissionAt}` |

Only fill this record after the candidate performs the corresponding action.
