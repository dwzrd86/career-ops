---
type: reference
title: Resume evidence review
created: 2026-10-14
tags:
  - resumes
  - factual-review
related:
  - '[[RESUME_STUDIO]]'
---

Resume Studio compares a draft with the source resume and displays numbers,
dates, metrics, email addresses, and HTTP links that are absent from the source.
This happens locally while editing, including after importing or generating a
draft. No additional provider request or persistence is introduced.

Repeated values appear once. Reordered text and letter case do not create new
findings. Numbers inside email addresses and URLs are excluded from the numeric
comparison, so a year in a portfolio URL cannot support an employment date.

These are literal comparisons for human review. Formatting differences can
produce findings, and a number reused in a different context may go undetected.
The check does not verify employers, qualifications, relationships between
claims, phone numbers as complete units, or factual accuracy. Review the full
draft against the source before marking it reviewed and exporting.

The existing review checkbox and Word, text, and print-to-PDF exports remain
the final steps. See [[RESUME_STUDIO]] for the full workflow.
