# 09 — OpenTelemetry Integration

**Tier:** High Value | **Effort:** Quick win (1-2 days) | **Priority:** Medium

## Problem

Users running markflow in production need visibility into workflow performance, step durations, and failure patterns through their existing monitoring stack (Grafana, Datadog, Honeycomb, Jaeger).

## Reference Implementations

- **Prefect:** Built-in observability UI with timeline views
- **Temporal:** Web UI with trace visualization
- **Dagger:** OpenTelemetry integration (2024)
- **Dagster:** Dagit UI with run timeline and asset lineage

## Proposed Design

### Configuration

`.workflow.json`:
```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "http://localhost:4318",
    "serviceName": "markflow"
  }
}
```

Or via environment:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 markflow run workflow.md
```

### Span hierarchy

```
workflow.run (root span)
├── step.build (child span)
│   ├── attributes: step.type=script, step.language=bash
│   └── events: step.output lines
├── step.test (child span)
│   ├── attributes: step.type=script, retry.count=2
│   └── events: retry.increment, step.complete
└── step.deploy (child span)
    └── attributes: step.type=agent, agent.cli=claude
```

### Span attributes

- `workflow.name`, `workflow.source`, `run.id`
- `step.name`, `step.type`, `step.language`
- `step.exit_code`, `step.edge`, `step.duration_ms`
- `retry.count`, `retry.max`

## Implementation Approach

The event-sourced log (idea 18) makes this a pure consumer — and enables a second mode.

### Mode 1: Live export (`onEvent` wrapper)

1. The `EngineEvent` system is a natural span boundary:
   - `step:start` → span start
   - `step:complete` → span end with attributes. `step.duration_ms = step:complete.ts − step:start.ts` (paired by `stepSeq`, not wall-clock).
   - `retry:increment` → span event
   - `workflow:complete` → root span end
2. Create a `TelemetryAdapter` that translates `EngineEvent` → OTEL spans.
3. Wire it as an `onEvent` wrapper in the CLI's `run` command.
4. Use `@opentelemetry/api` (lightweight, no auto-instrumentation overhead).

### Mode 2: Post-hoc backfill

Because the log is the source of truth, the same adapter can replay a completed run's `events.jsonl` into backfilled spans — useful for historical traces and for runs that weren't instrumented live. Expose this as `markflow trace <run-id>` or a library function `exportRunToOtel(runDir, exporter)`.

### Resume handling (idea 19)

On `run:resumed`, the adapter cannot reattach to the original root span (it may live in a different process / trace). Instead:

- Start a **new root span** for the resumed segment.
- Emit an OTel span link from the new root to the original run's root span (requires remembering the original `traceId`; store it in the `run:start` event attributes, or derive deterministically from `run.id`).
- This keeps both segments queryable together in the trace backend without inflating "one logical run" into one physical trace.

### Optional: trace context in the event envelope

To propagate W3C trace context into child processes (and so OTel-aware scripts/agents can nest their spans under the step span), add optional `traceId` / `spanId` to the event envelope alongside `seq`/`ts`. Not required for the core adapter — flag as an extension.

## What It Extends

- Pure consumer of the existing `EngineEvent` / `onEvent` system
- No engine changes needed
- New optional dependency: `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`

## Key Files

- `src/core/types.ts` (event types — read only)
- New: `src/core/telemetry.ts` (adapter)
- `src/cli/commands/run.ts` (wire adapter)
- `package.json` (optional peer dependency)

## Open Questions

- Should OTEL be a peer dependency or bundled?
- Should span events include step stdout/stderr (could be large)?
- Support W3C trace context propagation to child processes?
