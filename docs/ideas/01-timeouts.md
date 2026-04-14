# 01 — Timeouts

**Status** IMPLEMENTED
**Tier:** Essential | **Effort:** Quick win (1-2 days) | **Priority:** Highest

## Problem

Without timeouts, a hung agent call or stuck script blocks a workflow forever. Every major workflow system ships this as a core reliability primitive.

## Reference Implementations

- **GitHub Actions:** `timeout-minutes` per job/step
- **Step Functions:** `TimeoutSeconds` per state
- **Airflow:** `execution_timeout` per task

## Proposed Design

### Per-step timeout via config block

````markdown
## deploy

```config
timeout: 5m
```

```bash
./deploy.sh
```
````

### Workflow-level timeout in `.workflow.json`

```json
{ "timeout_default": "30m" }
```

Key name mirrors `max_retries_default` and self-documents the "default per-attempt value" semantics.

### Duration format

Support human-readable durations: `30s`, `5m`, `1h`, `1h30m`.

### Semantics: per-attempt, not cumulative

`timeout` bounds a single execution attempt of a step. Each retry (via `fail max:N`) gets a fresh timeout window — the budget does not accumulate across attempts. A step configured with `timeout: 5m` and `max:3` can therefore spend up to ~15 minutes of wall clock across retries.

The workflow-level `timeout` is the default per-attempt value applied to steps that don't declare their own. It is **not** a total-runtime cap for the whole workflow. (A separate total-run cap is out of scope for this change.)

## Implementation Approach

1. Parse `timeout` from a per-step ` ```config ` block into a new `stepConfig?: { timeout?: string }` field on `StepDefinition` — **not** overloaded onto `agentConfig`. This leaves room for future per-step options (env, retries override) without entangling agent semantics. The parser must also stop treating a `config` block as an agent-only signal — scripts need timeouts too, so step type is determined purely by whether a non-`config` code block follows.
2. Add `timeoutDefault` to `MarkflowConfig` (loaded from `.workflow.json` `timeout_default` and from the top-level ` ```config ` block).
3. In `engine.ts:executeToken`, wrap the `runStep` call with `AbortSignal.timeout(ms)` composed with the existing abort signal via `AbortSignal.any()`.
4. On timeout, emit a `step:timeout` engine event with payload `{ type, nodeId, tokenId, elapsedMs, limitMs }`, then synthesize a `fail`-edge output (exit code 124, matching GNU `timeout(1)`). Existing retry accounting handles `retry:exhausted` naturally on the terminal attempt.
5. Parse duration strings in a small utility (`src/core/duration.ts`).

## What It Extends

- `AbortSignal` plumbing (already exists in engine and runners)
- `StepAgentConfig` / config block parser
- `EngineEvent` union type

## Key Files

- `src/core/engine.ts` — `executeToken` method
- `src/core/types.ts` — `StepDefinition`, `EngineEvent`
- `src/core/parser/markdown.ts` — config block parsing
- `src/core/config.ts` — workflow-level config

## Non-goals

- **Total-workflow wall-clock cap.** Out of scope for this change.
- **SIGTERM → SIGKILL escalation.** This change only composes `AbortSignal.timeout` with the existing signal plumbing; whatever `runner/script.ts` and `runner/agent.ts` do today on abort is unchanged. Graceful-kill escalation is tracked separately.
- **Dedicated `timeout` edge label.** Timeouts route via `fail` for now. An explicit `timeout` label could be added later as pure opt-in.
