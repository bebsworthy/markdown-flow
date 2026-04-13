# 02 — Enhanced Retry Strategies

**Tier:** High Value | **Effort:** Medium (3-4 days) | **Priority:** High

## Problem

Current retry is budget-counting only (`fail max:N`). Real-world retries need:
- **Delays** between attempts (avoid hammering a failing API)
- **Exponential backoff** (progressively longer waits)
- **Jitter** (prevent thundering herd on shared downstream failures)

Error classification (don't retry auth failures, do retry timeouts) is deferred to v2 — it requires step authors to emit structured errors, and the right shape will be clearer once real failure patterns surface.

## Reference Implementations

- **Temporal:** Retry policies with `InitialInterval`, `BackoffCoefficient`, `MaximumAttempts`, `NonRetryableErrorTypes`
- **Step Functions:** `Retry` with `IntervalSeconds`, `BackoffRate`, `MaxAttempts`
- **Prefect:** `retries` + `retry_delay_seconds` (supports list for custom backoff)

## Proposed Design

Retry is a property of the **step**, not the edge. If a step declares a `retry` config and fails, it re-executes automatically. Only after retries are exhausted does the failure propagate along the `fail` edge.

### Step config block

````markdown
## api-call

```config
retry:
  max: 3
  delay: 10s
  backoff: exponential   # or: linear, fixed
  maxDelay: 5m
  jitter: 0.3
```
````

The graph no longer needs a self-loop to express "retry this step":

```
api-call --> next
api-call -->|fail| error-handler
```

`error-handler` runs only after all 3 attempts fail. Without a `retry` block, the step runs once and failure propagates immediately (current behavior).

### Relationship to `fail max:N`

Today `api-call -->|fail max:N| api-call` fakes step-level retry via a self-loop. With step-level retry this pattern becomes redundant. Options:

- **Keep both, document new form as preferred.** Self-loop still works; `retry.max` wins when both are specified.
- **Deprecate edge-based `max:N` over time.** Validator warns; eventually removed.

All non-zero exits are retryable (current behavior preserved).

## Implementation Approach

1. Extend the step-level `config` block parser in `parser/markdown.ts` to accept a `retry: { max, delay, backoff, maxDelay, jitter }` object.
2. Extend the `Step` type in `types.ts` with the retry policy.
3. Engine: on step failure, if the step has a `retry` policy and attempts remain, schedule re-execution after the computed delay (`delay * backoff^attempt`, capped by `maxDelay`, jittered). Bypass the router entirely for intrinsic retries.
4. Only after retries are exhausted does the router resolve the `fail` edge as usual.
5. Edge-level `fail max:N` remains functional; when both are present, step `retry.max` wins.

## What It Extends

- Step `config` block parser in `parser/markdown.ts`
- `Step` type in `types.ts`
- Engine failure-handling path — intrinsic retry loop before router dispatch

## Key Files

- `src/core/parser/markdown.ts`
- `src/core/router.ts`
- `src/core/types.ts`
- `src/core/engine.ts`

## Open Questions

- Workflow-level `retry_default` (mirroring `maxRetriesDefault` and `timeout_default`) — worth it in v1?
- Overall retry budget: do we need `maxElapsed` or is the workflow-level timeout sufficient?
- Retry + fan-in semantics: does a retrying node block siblings' downstream progress?
- Migration: deprecate edge-level `fail max:N` in favor of step `retry.max`, or keep both indefinitely?

## Deferred to v2

- Error classification (`retryOn`/`failOn`)
- `ERROR:` sentinel for structured error emission
- Regex matching on error messages
