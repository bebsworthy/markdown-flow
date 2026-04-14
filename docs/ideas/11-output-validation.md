# 11 — Structured Output Validation

**Tier:** Differentiating | **Effort:** Medium (3-4 days) | **Priority:** Medium

## Problem

Agent steps produce unpredictable output. Without schema validation, malformed data silently propagates to downstream steps, causing hard-to-debug failures far from the source. This is especially critical in AI workflows where LLM outputs are inherently non-deterministic.

## Reference Implementations

- **Orkes Conductor:** Input/output schema validation per task
- **Step Functions:** JSONPath-based input/output filtering with validation
- **LangGraph:** Structured output with Pydantic models
- **DSPy:** Typed signatures for LLM inputs/outputs

## Proposed Design

### Config block schema

````markdown
## classify

```config
output:
  label:
    type: string
    enum: [bug, feature, question]
  confidence:
    type: number
    min: 0
    max: 1
  tags:
    type: array
    items: string
```
````

### Validation behavior

- After step completion, validate `LOCAL` state against the output schema.
- On validation failure: treat as a step error (routes via `fail` edge, retryable).
- Agent steps: the schema is automatically included in the assembled prompt as instructions.

### Event model (event-sourced log, idea 18)

Validation is a post-step decision that can rewrite the step's routing edge, so it must land in the log — otherwise replay cannot reproduce the failure path. Emit a persisted event **after** the underlying `step:complete`:

```ts
{ type: "validation:failed"; v: 1; stepSeq: number; errors: Array<{ field: string; message: string }> }
```

Order is load-bearing: `step:complete` records what the process did, then `validation:failed` records the override. `replay()` applies them in order, and the step's final `StepResult` in `completedResults` is rewritten with the failure edge. Validation *success* emits nothing — absence of `validation:failed` for a `stepSeq` that has a schema is the pass signal.

This two-event shape keeps the validator a pluggable post-step concern: the runner doesn't need to know about validation to emit a correct `step:complete`. An alternative design — fold validation into the runner so only one `step:complete` is emitted with the final edge — couples runner and validator and is rejected.

Retry-on-validation-failure piggybacks on the existing retry pathway: emit `retry:increment` after `validation:failed` exactly as for any other failure. No new retry mechanism.

### Schema format

Use a simplified YAML schema (not full JSON Schema) for readability in markdown:

```yaml
output:
  fieldName:
    type: string | number | boolean | array | object
    required: true  # default: true
    enum: [a, b, c]
    min: 0
    max: 100
    pattern: "^[A-Z]"
    items: string  # for arrays
```

## Implementation Approach

1. Add `output` schema to `StepDefinition` / config block parsing.
2. After `runStep` returns and the engine has recorded `step:complete`, validate `parsedResult.local` against the schema.
3. On validation failure, follow the write-ahead rule (idea 18): `record("validation:failed", { stepSeq, errors })` → apply mutation (rewrite the `completedResults` entry's edge to the failure path, update token state) → dispatch handlers.
4. Add a case to `replay()` for `validation:failed` that rewrites the prior `step:complete` fold's edge/status.
5. For agent steps, inject the schema into the assembled prompt as formatting instructions.
6. Simple validation engine — no need for a full JSON Schema library for v1.

## What It Extends

- Config block parser in `parser/markdown.ts`
- `StepDefinition` in `types.ts`
- `engine.ts` — post-step validation
- `agent.ts` — schema injection into prompts

## Key Files

- `src/core/parser/markdown.ts`
- `src/core/types.ts`
- `src/core/engine.ts`
- `src/core/runner/agent.ts`
- New: `src/core/schema-validator.ts`

## Open Questions

- Should validation failure be retryable by default (gives agent another chance)?
- Should the schema support referencing GLOBAL keys as valid values?
- Full JSON Schema support vs. simplified YAML subset?
