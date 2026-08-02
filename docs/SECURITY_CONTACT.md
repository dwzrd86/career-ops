---
type: reference
title: Jobbie Security Contact and Vulnerability Reporting
created: 2026-08-01
tags:
  - security
  - vulnerability-disclosure
  - alpha
related:
  - '[[SECURITY]]'
  - '[[PRIVACY]]'
  - '[[INCIDENT_RESPONSE]]'
---

# Jobbie security contact

## Report a vulnerability or suspected compromise privately

Email **hi@santifer.io** with the subject `Jobbie security report`. Do **not**
open a public GitHub issue, discussion, or pull request for a vulnerability,
suspected exposed credential, account compromise, or potential unauthorized
data access.

Include only the minimum information needed to investigate:

- a concise description of the issue and affected URL or feature;
- safe reproduction steps, expected and observed behavior;
- likely impact and any mitigation already taken; and
- a way to contact you for follow-up.

Do not send passwords, authentication or reset codes, access tokens, private
keys, full resumes, job notes, application answers, or another user's personal
data. If a proof of concept needs sensitive material, first describe the
minimum safe way to share it.

## What to expect

The maintainer aims to acknowledge security reports within 72 hours, assess the
report privately, and coordinate a fix before public disclosure. A response
target is not a promise of resolution time or a guarantee of a reward. The
current coordinated-disclosure policy is also published in the repository's
root `SECURITY.md`.

## Account and privacy requests are different

For an export or deletion request about your own alpha account, follow the
manual process in [[PRIVACY]] and use the subject `Jobbie alpha data request`.
Security reports should use the subject above so they can be triaged without
mixing sensitive incident details with ordinary support.

## Responsible reporting expectations

Do not access, alter, delete, or retain data that is not yours; do not disrupt
the service; and do not attempt to bypass account isolation beyond the minimum
needed to demonstrate an issue. Stop if you encounter personal data and report
the exposure. The incident owner will use [[INCIDENT_RESPONSE]] when that
procedure is added for the alpha.
