# 03 — Workflow Error Handlers / Finally Blocks

**Tier:** High Value | **Effort:** Medium (3-4 days) | **Priority:** High

## Problem

When a workflow fails with an unhandled error, there's no way to run cleanup, send notifications, or ensure audit trail completion. Users need:
- **On Error:** steps that run on any unhandled failure
- **Finally:** steps that always run regardless of outcome

## Reference Implementations

- **GitHub Actions:** `if: always()`, `if: failure()`, `if: success()` on any step
- **Step Functions:** `Catch` blocks with fallback states
- **Airflow:** `on_failure_callback`, `on_success_callback` per task/DAG

## Proposed Design

### New markdown sections

```markdown
# On Error

## notify-failure

```bash
curl -X POST $SLACK_WEBHOOK -d "{\"text\": \"Workflow failed: $MARKFLOW_ERROR_MESSAGE\"}"
```

# Finally

## cleanup

```bash
rm -rf /tmp/build-artifacts
docker stop test-container || true
```
```

### Naming

Keeping `# Finally` (not `# On Finally`) to match the try/catch/finally idiom and stay terse. To avoid collision with prose documentation, the parser only treats `# Finally` as a handler section when it contains `##` step children; a bare `# Finally` heading with prose underneath is left as documentation, and the validator emits a warning suggesting renaming if the author likely intended a handler.

### Interaction with existing failure routing

`fail` / `fail max:N` / `fail:max` edges handle **step-local** recovery inside the graph. `# On Error` is the **workflow-level** fallback for failures that escape the graph. A failure is considered "unhandled" and triggers `# On Error` when:
- the failing step has no `fail` edge, OR
- the failing step's `fail:max` edge is absent and retries are exhausted, OR
- routing from a `fail` edge itself terminates at a node with no further handling and a non-zero exit.

If any `fail` edge catches the failure, `# On Error` does **not** run — the graph handled it.

### Execution order

- **On success:** Finally steps only.
- **On unhandled failure:** On Error steps first (sequentially, top to bottom), then Finally steps.
- In-flight parallel tokens are cancelled before handlers run; the engine waits for their cancellation to settle so handlers see a quiesced state.
- Handlers run **once per workflow run**, not per failing token — concurrent branch failures collapse into a single `# On Error` invocation (first failure populates the error context).

### Handler step semantics

- Steps within each section execute sequentially (top to bottom).
- Handler steps inherit the existing step-level `timeout` and `retry` config — a hung handler cannot hang the run.
- Errors in `# Finally` are logged but do **not** change the workflow's final status. A per-step `strict` marker opts into propagation (useful for audit-trail completion where a missed flush should fail the run).
- Errors in `# On Error` are logged; they do not re-trigger `# On Error`. Subsequent On Error steps still run. The workflow's final status remains `error`.
- Both sections are optional.

### Context available to handlers

All handlers receive:
- `GLOBAL` — accumulated workflow state up to the point of failure
- `STEPS` — all completed step results
- `MARKFLOW_STATUS` — `complete` or `error`

On Error handlers additionally receive a structured error context:
- `MARKFLOW_ERROR_STEP` — name of the failing step
- `MARKFLOW_ERROR_MESSAGE` — error message (stderr tail for scripts, last output or routing-failure reason for agents)
- `MARKFLOW_ERROR_EXIT_CODE` — exit code for script steps; for agent steps, one of `agent_nonzero`, `route_unresolved`, `timeout`, `retries_exhausted`

## Implementation Approach

1. Add `onError` and `finally` step arrays to `WorkflowDefinition` in `types.ts`.
2. Extend `parseMarkdownSections` in `parser/markdown.ts` to recognize `# On Error` and `# Finally` sections (only when they contain `##` step children).
3. In `engine.ts`, wrap the main execution in try/catch/finally:
   - On catch: cancel in-flight tokens, execute `onError` steps sequentially, then `finally` steps.
   - On success: execute `finally` steps only.
4. Handler steps dispatch through the existing `runStep()` so they inherit timeout/retry handling for free.
5. Handler steps are not part of the Mermaid graph — they're triggered by the engine lifecycle.

### Validator impact

`validator.ts` must:
- Ensure handler step names do not collide with graph node names.
- Require ≥1 `##` step under `# On Error` / `# Finally` if the section is present (otherwise treat as prose and warn).
- Ensure `strict` markers are only applied to Finally steps.

### Events

`EngineEvent` gains:
- `handler:start` — `{ section: 'onError' | 'finally', step }`
- `handler:complete` — `{ section, step, result }`
- `handler:error` — `{ section, step, error }` (emitted even when the error is swallowed by non-strict Finally)

## What It Extends

- `parseMarkdownSections` in `parser/markdown.ts`
- `WorkflowDefinition` in `types.ts`
- Engine execution lifecycle in `engine.ts`
- `validator.ts` (name-collision and structural checks)
- `EngineEvent` (new events above)

## Key Files

- `src/core/parser/markdown.ts`
- `src/core/engine.ts`
- `src/core/types.ts`
- `src/core/validator.ts`

## Resolved Questions

- **Error context shape:** structured env (`MARKFLOW_ERROR_STEP`, `MARKFLOW_ERROR_MESSAGE`, `MARKFLOW_ERROR_EXIT_CODE`) rather than a single string. Scales to both script and agent failure modes.
- **Finally and exit code:** non-strict by default (log and move on). A per-step `strict` marker propagates failure to the run's exit code.

## Deferred

- **Parallel handlers via sub-graph:** sequential-only for v1. A follow-up could allow an optional Mermaid block inside `# On Error` / `# Finally` to express parallel teardown (stop container + delete tmp + notify in parallel). Out of scope for the initial 3–4 day estimate.
