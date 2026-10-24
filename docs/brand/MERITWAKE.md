---
type: reference
title: Meritwake identity and Fieldnotes design collection
created: 2026-10-19
tags:
  - brand
  - design
  - beta
related:
  - '[[RESUME_STUDIO]]'
  - '[[RELEASE_RUNBOOK]]'
  - '[[JOBBIE-BETA-01]]'
---

# Meritwake

Chosen product name: **Meritwake** (MER-it-wake). Merit is the experience and
evidence a candidate brings; wake is the movement that follows deliberate action.
The name supports both finding the next role and managing a longer career.

Tagline: **Your next move. Backed by proof.**

Product description: A career workspace that helps you find suitable roles,
prepare factual tailored resumes, and keep your applications moving.

The Fieldnotes identity was applied to the actual web UI on 2026-10-24, including
the wordmark, palette, access screens, page title, favicon and export metadata.
Account data, infrastructure IDs, URLs and agent identity remain unchanged.
See [[BETA_TESTING]] for verification and hosted-release limits. The static board at
`docs/brand/meritwake-identity.html` uses fictional evidence and makes no AI calls.

## Design collection — Fieldnotes

An editorial desk for an intentional job search: a dark navigation rail, warm
paper workspace, structured role cards, and an application brief with a clear
next action. Use spacing and typographic hierarchy to show importance. Reserve
the bright accent for the next meaningful action and a small number of marks.

| Token | Value | Role |
| --- | --- | --- |
| Midnight | `#142536` | Navigation, headings, main text |
| Field paper | `#F5F3EB` | Main workspace background |
| Document | `#FFFEFA` | Cards and resume paper |
| Signal | `#CCF779` | Primary actions and brand mark, with Midnight text |
| Verified | `#225B41` | Reviewed states and success, with text labels |
| Slate | `#566675` | Supporting text on light surfaces |
| Rule | `#D8DDD4` | Dividers and quiet borders |
| Caution | `#81540F` | Review requirements and uncertain evidence |

Headings: expressive editorial serif; body and controls: clear sans serif.
The board uses Georgia and Arial/system fallbacks, with no external font requests.
If custom type is adopted, use self-hosted, licensed font assets; do not add
third-party font requests to private account pages. Keep exported ATS documents
in conventional single-column typography rather than reproduce the brand layout.

The initial vector mark combines angular M strokes with an ascending line.
Keep it readable at 24 pixels and pair it with a lowercase wordmark. This is
repo-native SVG, not an AI-generated raster logo. Do not use registration or
trademark symbols without an established basis.

## Interaction and language

- First screen: next action, suitable opportunities, and active application brief.
- Role cards explain relevant evidence and explicitly label unknown requirements.
- Workflow: Discover → Shortlist → Prepare → Review → Export → Track.
- Use visible text for state; never rely on green alone to imply approval.
- Source facts and generated drafts stay distinguishable. Editing invalidates review.
- No invented ATS score, guaranteed interview claim, or automatic application submission.
- Use the existing Lucide icon set during implementation, consistent focus rings,
  responsive layouts, and reduced-motion preferences. Board icons are only sketches.
- Avoid robot mascots, ornamental dashboards, and competing calls to action.

## Sender and beta branding

New default sender proposal: **Meritwake <meritwake@dmdtechnologies.net>**.
This supersedes the planning-only Jobbie sender; neither is asserted to be
configured. A sending identity does not imply a receiving mailbox. Continue to
resolve an actual monitored support/Reply-To address during release preparation.
Use the existing Netlify URL or an owned-domain subdomain after target selection;
do not buy a new domain for the beta. Keep the shared $10/month API ceiling.

## Initial conflict screen

Exact-name web searches for `Meritwake` and `Meritwake careers software` on
2026-10-19 returned no indexed results in the search tool. This is limited
negative evidence, not domain availability, a trademark search, or legal clearance.
No domain was queried through a registrar or purchased. Recheck before a broad
public brand launch. Avoid the original Jobbie.bot competitor name.

The rejected candidate Roleward is already used by an AI career workspace:
[Roleward product](https://roleward.org/how-it-works). Proofward also has existing
AI/evidence branding; the selected name avoids those observed exact matches.

## Implementation scope

Update visible UI name, document title/favicon/mark, access screens, account emails,
and current beta-facing documentation. Apply the design tokens by extending the
existing stylesheet/components. Keep auth, review gating, and exports intact.
Leave deployment names, database IDs, provider credentials, repo names, saved
playbook IDs, and historical reports stable. Avoid a blind repository-wide text
replacement. Brand implementation belongs in the beta playbook with verification.
