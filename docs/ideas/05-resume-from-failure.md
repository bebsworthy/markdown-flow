# 05 — Execution Resume from Failure

**Status** IMPLEMENTED
**Tier:** High Value | **Effort:** Medium (3-5 days) | **Priority:** High

**Depends on:** [18 — Event-Sourced Run Log](18-event-sourced-log.md) (shipped) and [19 — Engine Resume Entry Point](19-resume-entry-point.md). Idea 19 supplies the `openExistingRun` / `resumeFrom` primitive this feature builds on.

## Problem

Long-running workflows that fail at a late step must re-run everything from scratch. Expensive early steps (data fetching, builds, API calls) are wasted. Users need to resume from the point of failure.

## Reference Implementations

- **Temporal:** Full history replay — deterministic re-execution skips completed activities
- **Dagster:** Re-execution from failure with `ReexecutionOptions`
- **Prefect:** Task state caching with `cache_key_fn`
- **Airflow:** `airflow tasks clear` to reset specific tasks and re-run

## Proposed Design

### CLI command

```bash
# Resume the most recent failed run
markflow resume <run-id>

# Resume with updated inputs (e.g., fix a typo)
markflow resume <run-id> --input API_KEY=new-value
```

### Behavior

1. `openExistingRun(id)` (idea 19) folds `events.jsonl` through `replay()` into an `EngineSnapshot` — completed step results, `globalContext`, retry budgets, and token states are all restored.
2. The engine is started with `resumeFrom: { snapshot, lastSeq, tokenCounter }`. Tokens in `complete` / `skipped` are already terminal in the snapshot; no per-node skip logic is needed in `executeToken`.
3. A `run:resumed` event is appended as the first new entry in the existing log. Execution continues from whatever tokens are still `pending`.
4. No new run id — the resumed run appends to the original log. (Forking is strictly more work; append is the right default, see idea 19.)

### Selective re-run

```bash
# Force re-run specific steps even if they completed
markflow resume <run-id> --rerun step-a,step-b
```

For each listed step, the CLI appends a `token:reset` event (specified in idea 19) before `run:resumed`. `replay()` folds these by moving the matching token's state from `complete` back to `pending` and clearing its `edge`/`result`; the normal resume path then re-dispatches it.

## Implementation Approach

This feature is a thin CLI wrapper on top of idea 19.

1. New CLI command `resume` in `src/cli/commands/resume.ts`:
   - Calls `runManager.openExistingRun(runId)`.
   - For each `--rerun <step>`, appends a `token:reset` event (idea 19).
   - Invokes `executeWorkflow(workflow, { ...opts, resumeFrom: handle })`.
2. `--input FOO=bar` overrides are applied to `resumeFrom.snapshot.globalContext` before dispatch (or via a new `global:update` event appended before `run:resumed`, so the override is auditable in the log).
3. No engine changes required beyond what idea 19 already introduces — completed tokens are terminal; no `step:skipped` event is needed at resume time.

## What It Extends

- CLI (new `resume` command)
- Consumes idea 19's `openExistingRun`, `resumeFrom`, and `token:reset` — no new engine/event surface of its own.

## Key Files

- `src/cli/commands/resume.ts` (new)
- Engine/run-manager/event-logger changes all live in idea 19.

## Open Questions

- GLOBAL state is now resolved — `global:update` events fold deterministically via `replay()` (idea 18). Overrides from `--input` are appended as an explicit `global:update` before resume so they're visible in the log.
- Schema drift (workflow file changed since original run) and graph-topology drift are specified in idea 19's Open Questions — the resume primitive owns the detection; this feature just surfaces the error.
- Should retry budgets carry over from the original run? Default yes (they're in the snapshot). A `--reset-retries` flag could clear them before resume; defer unless a user asks.
