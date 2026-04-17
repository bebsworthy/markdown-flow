# Notes

## What I built

Converted the described daily script into a markflow workflow with five nodes:

- `fetch` — bash + `curl -fsSL` against `sales_url`. Uses a **step-level
  `retry:` policy** (`max: 5`, `delay: 2s`, `backoff: exponential`,
  `jitter: 0.3`) to satisfy "retry up to 5x with exponential backoff". In-place
  retries are the right mechanism here: we want the exact same call re-issued
  with backoff, no graph branching.
- `transform` — python3 reads the raw JSON path from `GLOBAL`, writes a
  transformed file, republishes the new path on `GLOBAL`.
- `upload` — bash `aws s3 cp`. Given a small retry policy (3 attempts) since
  S3 puts are also occasionally flaky; harmless and matches production habits.
- `notify` — the shared failure sink. Any of `fetch` / `transform` / `upload`
  failing routes here via their `fail` edge. Sends a digest via `mail` to
  `ops_email`, then `exit 1` so the run is recorded as failed.
- `done` — terminal success marker.

## Design choices

- Inputs (`sales_url`, `s3_target`, `ops_email`) are declared under `# Inputs`
  so operators can override via `.env` without editing the workflow.
- Every failure edge points at the same `notify` node, so a single mail path
  covers fetch-after-retries-exhausted, transform errors, and upload errors.
- Used `RESULT: {"edge": "pass", ...}` explicitly on the happy path so each
  step's intent is obvious in the run log, even though the engine could infer
  it from exit code 0 on a single labeled edge.
- Data passes between steps via `GLOBAL` (raw_path, transformed_path, count)
  rather than `RESULT.summary`, per the skill's house style.

## Validation

Ran `markflow init` against the workflow. Exit code 0, no errors. See
`validation.txt` for the command and output.
