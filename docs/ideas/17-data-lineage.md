# 17 — Data Lineage / Provenance Tracking

**Tier:** Differentiating | **Effort:** Medium (3-4 days) | **Priority:** Low

**Depends on:** [18 — Event-Sourced Run Log](18-event-sourced-log.md) (shipped). Most write-tracking scope is already provided by 18; see "What 18 already gives us" below.

## Problem

In complex workflows, it's hard to trace which steps produced and consumed which data. When a downstream step has bad data, users need to trace backwards through the chain to find the source.

## Reference Implementations

- **Dagster:** Asset-centric model with automatic lineage tracking, metadata capture, quality checks
- **Prefect:** Task dependency visualization
- **Airflow:** XCom lineage (limited)

## Proposed Design

### Automatic tracking

The engine tracks GLOBAL key mutations per step:

```json
{
  "step": "fetch-data",
  "wrote": ["items", "totalCount"],
  "read": ["apiUrl"]
}
```

```json
{
  "step": "process",
  "wrote": ["results"],
  "read": ["items"]
}
```

### Lineage visualization

```bash
markflow lineage <run-id>

# Output:
# apiUrl
#   └── fetch-data (read)
#
# items
#   ├── fetch-data (write)
#   └── process (read)
#
# results
#   └── process (write)
```

### What 18 already gives us (write tracking — free)

Idea 18 ships `global:update { keys: string[], patch: Record<string, unknown> }` as a persisted event, emitted every time a step mutates `GLOBAL`. That's exactly the write half of lineage, already in the log. Pairing each `global:update` with the enclosing `step:start` (by `stepSeq`) yields `{ node, wrote: keys }` without any new storage.

So the writes side of lineage is a **pure projection of `events.jsonl`** — no `StepResult.lineage` field, no new storage, no engine changes. `markflow lineage <run-id>` becomes a reader that folds:

```ts
function buildLineage(events: EngineEvent[]) {
  // Walk events; for each step:start → step:complete window,
  // collect global:update.keys as writes and (TBD) GLOBAL reads as reads.
}
```

### What remains — read tracking

Read tracking is the only unsolved piece. LiquidJS doesn't natively expose which variables it accessed during rendering. Options (same as before, still unresolved):

1. Wrap the context object in a Proxy that logs property access; emit a new persisted `global:read { stepSeq, keys: string[] }` event before `step:start` completes its prompt assembly.
2. Static analysis of template strings (fragile, misses dynamic access).
3. Post-hoc analysis comparing step inputs to available GLOBAL keys.

Recommend option 1 with a persisted `global:read` event — keeps lineage fully reconstructible from the log and matches the invariant from 18 that every observable state interaction is an event.

## Implementation Approach

1. Write a `markflow lineage <run-id>` CLI command that reads `events.jsonl` via the existing `readEventLog` helper, walks it, and emits the `{ read, wrote }` projection per step.
2. For read tracking: instrument the template renderer with a Proxy that records accessed `GLOBAL` keys during each step's template expansion. Emit a persisted `global:read { stepSeq, keys }` event before `step:start` dispatch.
3. Add a replay case for `global:read` that maintains a `reads: Map<stepSeq, string[]>` projection on the snapshot.
4. forEach / dynamic-step lineage rollup: once idea 07 adds `parentTokenId`/`batchId` to `token:created`, batch-level lineage is a straightforward fold over per-item lineage — no extra design needed here.

## What It Extends

- Template renderer in `template.ts` (read tracking via Proxy)
- `EngineEventPayload` (new `global:read` variant)
- `replay()` (new fold for reads projection)
- New: `src/cli/commands/lineage.ts`

## Key Files

- `src/core/template.ts`
- `src/core/types.ts`
- `src/core/replay.ts`
- New: `src/cli/commands/lineage.ts`

## Open Questions

- Is automatic read tracking worth the complexity, or is write tracking sufficient?
- Should lineage support LOCAL state tracking too?
- How to visualize lineage for forEach/dynamic steps?
