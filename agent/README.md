# Local Career Ops Agent

The local agent owns autonomous-discovery state. It is deliberately separate
from the hosted frontend and from Interceptor browser credentials.

## Target Profile

```bash
npm run profile -- init
npm run profile -- edit
npm run profile -- validate
npm run match -- --job agent/test/fixtures/matching/ranked-job.json
npm run match -- --job-id greenhouse-acme-123
```

`edit` starts a loopback-only editor and prints a URL containing a per-run
capability token in its fragment. Keep the terminal open while editing. The
token is never written to disk or sent to Convex.

The saved `config/target-profile.yml` is ignored by Git. It may contain local
resume/evidence paths, but never resume content, browser credentials, or
job-board cookies.

## Explainable matching

`npm run match` requires a saved, validated Target Profile (`profileVersion >=
1`) and either a normalized JSON record (`--job`) or a local discovered-job
record (`--job-id`). It prints the hard-filter result, score/subscores, and
stable explanation codes without reading raw resumes or job descriptions.

Hard-filter failures are rejected before scoring. Missing structured evidence
stays `unknown` and produces `needs-review`; it is never assumed to match.

## Boundary

Future collectors may write validated discovery records to the local agent
store. They must not invoke an AI CLI. Evaluation remains a separate,
user-approved operation that reuses the existing Career Ops report flow.

## Collector data boundary

Normalization stores only validated, metadata-only discovered-job records.
When a collector is explicitly given job-detail text, its SHA-256 and an
ignored local `data/autodiscovery/details/` snapshot path are retained in the
record; the text is never included in a record, decision, or scan-run log.

Every scan run is saved locally under `data/autodiscovery/scan-runs/` with the
Target Profile version, safe error codes, and the bounded outcomes `active`,
`expired`, `blocked`, `duplicate`, `rejected`, or `shortlisted`. Deduplication
checks canonical URL, then the provider's external ID, then normalized
company/title/location. All files in this local workspace are ignored by Git.

## Interceptor collector setup

Interceptor is an opt-in, local-only fallback for career sources without a
public ATS feed. Before enabling it, create a separate Chrome profile named
`Jobbie Discovery`, install/enable Interceptor only in that profile, and sign
in manually only to sources you approve. Never pair Interceptor with a personal
browser profile.

In `config/target-profile.yml` (which is ignored and written with mode 0600),
enable the `interceptor` source and configure its exact dedicated context ID
plus each approved HTTPS career-site path:

```yaml
discovery:
  sources: [greenhouse, ashby, lever, interceptor]
  schedule: manual
  maxPerRun: 100
  enabled: true
  interceptor:
    contextId: jobbie-discovery-2026
    allowedSources:
      - https://careers.example.com/jobs
```

The allowlist applies to the URL path as well as the host: an entry permits the
listed path and its descendants only. Do not allowlist login, apply, submit,
account, or generic-home URLs.

`readInterceptorCareerPage` accepts only a matching explicit context ID, an
allowlisted URL, `listing` or `detail` page kind, and the fixed main-content
selectors. Its injected local CLI adapter receives this one narrow request:

```js
{
  action: "read-career-page",
  contextId: "jobbie-discovery-2026",
  url: "https://careers.example.com/jobs/123",
  pageKind: "detail",
  selectors: ["main", "[role=\"main\"]"]
}
```

No other browser operation is available. In particular, the collector never
requests or exports cookies, browser storage, history, passwords, credentials,
or session data; it refuses apply/submit routes and selectors. The adapter must
return `{ ok: true, page: { url, title, text } }` for a read. Treat missing
context, login, CAPTCHA, access denial, and navigation errors as the returned
bounded `blocked` outcome and fix the dedicated browser setup manually—never
attempt a bypass, CAPTCHA solver, or credential export. Pass detail text
directly to normalization so it remains only in ignored local snapshots, never
in scan-run logs.
