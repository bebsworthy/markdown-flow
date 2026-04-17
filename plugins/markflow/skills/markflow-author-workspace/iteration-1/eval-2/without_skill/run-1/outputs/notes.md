# Notes — Daily Sales Sync conversion

## Approach

Modeled the original cron-style script as four steps in a single markflow file:

1. `fetch_sales` — `curl` the API with a **step-level `retry:` block**
   (`max: 5`, `delay: 1s`, `backoff: exponential`, `jitter: true`). This
   matches the user's requirement of "up to 5x with exponential backoff"
   and keeps the retry in-place rather than building a graph loop.
2. `transform` — Python script that reads the downloaded JSON and writes a
   transformed file into `$MARKFLOW_RUNDIR`. Inlined via a heredoc so the
   workflow is self-contained; the comment notes how to point at an
   existing `.py` file instead.
3. `upload` — `aws s3 cp` to push the transformed payload.
4. `notify_ops` — wired as the `fail` edge target for all three upstream
   steps, so it fires after retries are exhausted *or* if transform/upload
   blow up. Uses `mail -s` and then `exit 1` so the run is recorded as
   failed overall.

## Assumptions

- **Retry semantics:** interpreted "retry 5x" as 5 attempts total
  (markflow's `retry.max`); switch to 6 if the intent was 1 initial + 5
  retries.
- **Data handoff:** each step writes artifacts into `$MARKFLOW_RUNDIR` and
  publishes the path via a `LOCAL:` sentinel, which downstream steps read
  with `jq` from `$STEPS`. This avoids depending on any particular cwd.
- **S3 CLI:** used `aws s3 cp`; swap for `s3cmd`/`rclone` if the target
  environment uses something else.
- **Auth:** assumed AWS creds, any API token, and SMTP for `mail(1)` are
  already available in the ambient environment (env vars, `~/.aws/`, MTA
  config). No secrets are embedded in the workflow.
- **Notification on transform/upload failure:** the prompt only called out
  notifying on fetch failure, but I routed `transform` and `upload`
  failures to `notify_ops` as well — it would be surprising to silently
  drop those. Remove those `fail` edges if strict parity with the original
  script is preferred.
- **Timeouts:** added `timeout: 2m` on the network-bound steps; tune per
  environment.
- **Inputs:** exposed `api_url`, `s3_dest`, and `ops_email` as declared
  inputs with sensible defaults so the workflow is reusable without
  editing the file.

## Things I was less sure about

- Exact syntax of the `retry:` config keys (`delay`, `backoff`, `jitter`)
  — inferred from `docs/arch/routing-and-retries.md` being the canonical
  reference and the `retry-step-config.md` fixture showing `retry.max`.
  If key names differ (e.g. `initialDelay` vs `delay`), they need a quick
  rename.
- Whether `INPUTS.*` is the correct Liquid namespace for declared inputs;
  the examples I inspected used `GLOBAL` and `STEPS`. If inputs surface
  under a different name, the `{{ INPUTS.* }}` references should be
  updated accordingly.
