# 06 — Conditional Step Inclusion

**Tier:** High Value | **Effort:** Quick win (2 days) | **Priority:** High

## Problem

Users need to enable/disable steps based on inputs, environment, or runtime conditions without creating separate workflow files or complex branching in the Mermaid graph. Currently, conditional execution requires explicit branch nodes.

## Reference Implementations

- **GitHub Actions:** `if: ${{ github.event_name == 'push' }}` on any step
- **Airflow:** `BranchPythonOperator`, `ShortCircuitOperator`
- **Step Functions:** `Choice` state with conditions

## Proposed Design

### Config block condition

````markdown
## deploy-canary

```config
if: "{{ ENV == 'production' }}"
```

```bash
./deploy-canary.sh
```
````

````markdown
## send-slack-notification

```config
if: "{{ GLOBAL.tests_passed and ENV != 'local' }}"
```

```bash
curl -X POST $SLACK_WEBHOOK ...
```
````

### Behavior when condition is false

1. Evaluate the rendered `if` expression **before** appending `step:start` — a skipped step must never have a `step:start` event in the log, otherwise replay would see an orphan start with no matching completion.
2. Append a persisted `step:skipped` event:
   ```ts
   {
     type: "step:skipped";
     v: 1;
     stepSeq: number;        // this event's own seq — there is no prior step:start to reference
     tokenId: string;
     nodeId: string;
     reason: "condition_false";
     edge: string;           // the routing edge taken (see below) — carried so replay is deterministic
   }
   ```
3. `replay()` folds `step:skipped` by: setting `token.state = "skipped"`, appending a `StepResult` to `completedResults` with `status: "skipped"` and the event's `edge`, then applying routing the same as a completed step would.
4. **Edge selection when skipped:** always the default/unlabeled edge (matches existing skip semantics). The engine computes this at emit time and records it in the event payload; replay never re-evaluates routing.
5. `step:skipped` is persisted (must not appear in `NON_PERSISTED_EVENT_TYPES`).

### Condition evaluation

- Uses the existing LiquidJS template engine.
- Condition is evaluated in the same context as step templates: `GLOBAL`, `STEPS`, `LOCAL`, inputs, env vars.
- Truthy evaluation: non-empty string, non-zero number, non-empty object/array = true.
- The `if` value is rendered, then evaluated as truthy/falsy.

## Implementation Approach

1. Add optional `if` field to `StepDefinition` in `types.ts`.
2. Parse `if` from the config block in `parser/markdown.ts` (already parses arbitrary config keys).
3. In `engine.ts:executeToken`, before calling `runStep`:
   - If `step.if` is defined, render it via the template engine with current context.
   - If the rendered result is falsy, compute the outgoing edge, then follow the write-ahead rule from 18: `record("step:skipped", { …, edge })` → apply mutation (`token.state = "skipped"`, routing) → dispatch handlers. Do **not** emit a `step:start` for this token.
4. Add a case to `replay()` for `step:skipped` (strict — unknown `tokenId` throws `InconsistentLogError`).
5. The validator could optionally warn about `if` conditions that reference undefined variables.

## What It Extends

- `StepDefinition` in `types.ts` (new `if` field)
- Config block parser in `parser/markdown.ts`
- `executeToken` in `engine.ts` (pre-execution check)
- Template renderer in `template.ts`

## Key Files

- `src/core/engine.ts`
- `src/core/types.ts`
- `src/core/parser/markdown.ts`
- `src/core/template.ts`

## Open Questions

- Should `if` conditions be validated at parse time (static analysis of referenced variables)?
- Should there be an `unless` shorthand for negated conditions?

Resolved inline above:
- **Skipped edge** → default/unlabeled edge, recorded in the `step:skipped` event payload.
