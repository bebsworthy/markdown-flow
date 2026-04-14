# Testing Harness

The `markflow/testing` entry point provides `WorkflowTest`, a harness that
injects synthetic step results through the engine's `beforeStep` hook so tests
run fast with no network or agent calls.

## Basic usage

```typescript
import { WorkflowTest } from "markflow/testing";

const wft = await WorkflowTest.fromFile("./ci.md");

// Single mock — every call to this node returns the same result
wft.mock("fetch-ticket", { edge: "pass", summary: "Fetched TKT-123" });

// Sequential — each call consumes the next entry; last entry repeats
wft.mock("test", [{ edge: "fail" }, { edge: "fail" }, { edge: "pass" }]);

const result = await wft.run({
  inputs: { DEPLOY_TARGET: "staging" },
  // Optional: seed the per-run working directory before execution
  workdirSetup: async (dir) => {
    await writeFile(join(dir, "ticket.json"), JSON.stringify(fixture));
  },
});

expect(result.status).toBe("complete");
expect(result.callCount("test")).toBe(3);
expect(result.edgeTaken("test", 1)).toBe("fail");
expect(result.edgeTaken("test", 3)).toBe("pass");
expect(result.events.filter(e => e.type === "retry:increment")).toHaveLength(2);
```

Unmocked steps run for real — mock only the steps you need to isolate.

## Mock directive

A mock entry accepts:

- `edge: string` — which outgoing edge to take (required).
- `summary?: string` — populates `StepResult.summary`.
- `exitCode?: number` — for script steps; defaults to `0` for non-`fail` edges, `1` for `fail`.
- `local?: Record<string, unknown>` — merged into `LOCAL` for subsequent invocations of the same step.
- `global?: Record<string, unknown>` — emitted as a `global:update`.

The harness consumes entries in order. When the list runs out, the final entry repeats — convenient for "this step always succeeds after N attempts" shapes.

## Run assertions

`wft.run()` resolves to a `RunResult` with helpers for common shapes:

- `status` — `"complete"` or `"error"`.
- `callCount(nodeId)` — how many times that step was invoked.
- `edgeTaken(nodeId, n)` — the edge the `n`-th invocation resolved to (1-indexed).
- `events` — full `EngineEvent[]` captured during the run. Filterable by `type` to assert on retry counts, routing choices, etc.
- `steps` — completed `StepResult[]` in execution order.

## Relation to `beforeStep`

`WorkflowTest` is a thin wrapper around the engine's `beforeStep` hook (see `EngineOptions.beforeStep` in `src/core/types.ts`). For test setups that don't fit the mock-list model — e.g. "check the call count before deciding what to return" — pass a custom `beforeStep` directly to `executeWorkflow`.

## See also

- [`routing-and-retries.md`](routing-and-retries.md) — what edges your mocks can target.
- [`event-sourced-run-log.md`](event-sourced-run-log.md) — the event shapes surfaced in `result.events`.
