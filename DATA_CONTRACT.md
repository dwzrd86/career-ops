# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `config/target-profile.yml` | Your versioned discovery and matching preferences |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/applications.md` | Your application tracker |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/follow-ups.md` | Your follow-up history |
| `writing-samples/*` | Your personal writing samples for style calibration |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |
| `data/autodiscovery/*` | Local discovery records, scan runs, matches, and material references |
| `data/autodiscovery-backups/*` | Operator-created encrypted backups of the local discovery workspace |
| `data/autodiscovery-exports/*` | Operator-created local exports; they are not a hosted projection or release artifact |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `CLAUDE.md` | Agent instructions |
| `AGENTS.md` | Codex instructions |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `agent/*` | Local discovery-agent implementation and non-personal templates |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**

## Local discovery retention, backup, and export boundary

`data/autodiscovery/` is a private local workspace, not a cache that an update,
scheduler, or hosted account-deletion action may prune. It can contain
discovered-job records, raw local job-detail snapshots, review artifacts,
evaluation references, and scheduler state. Retain it only for the period the
owner needs for their job search, then delete it locally using the owner's
approved retention procedure.

If the owner needs a backup, create an encrypted local backup in
`data/autodiscovery-backups/`, keep the encryption key outside the repository,
and test restoration into a separate private directory. Do not include an
Interceptor browser profile, browser cookies, browser tokens, `.env` files, or
provider credentials. Any local export belongs under
`data/autodiscovery-exports/`, remains ignored, and must be reviewed before it
leaves the device.

The optional Convex discovery projection is a separate, explicit bridge. It
may contain only its bounded metadata contract; it must never upload raw resume
content, raw job-description content, local paths, Target Profile form values,
browser state, application answers, or generated draft material. A hosted
account export/deletion affects only hosted alpha records and does not alter
the local discovery workspace or its backups.
