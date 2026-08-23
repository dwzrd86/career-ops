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
