# 19 — Engine Resume Entry Point

**Status** IMPLEMENTED
**Tier:** Foundational | **Effort:** Small (2-3 days) | **Priority:** High

**Depends on:** [18 — Event-Sourced Run Log](18-event-sourced-log.md) (shipped).

**Unblocks:** [04 — Approval Nodes](04-approval-nodes.md), [05 — Resume from Failure](05-resume-from-failure.md), and any future feature that needs to restart execution from a persisted run.

## Problem

Idea 18 made run state recoverable: `replay(readEventLog(runDir))` produces a full `EngineSnapshot`. But nothing in the engine currently *consumes* a snapshot — every execution starts fresh.

- `RunManager.createRun` always allocates a new run directory.
- `EventLogger` always starts `seq` at 0.
- `EngineOptions` has no field for pre-populated state.
- Token IDs are assigned from an internal counter that resets on every run.

Two independent ideas (04 approval nodes, 05 resume-from-failure) both need the same primitive: open an existing run, replay its log, and continue execution from the resulting snapshot. Specifying it once, here, keeps both feature docs focused on their own semantics.

## Reference Implementations

- **Temporal:** deterministic replay rebuilds worker state from history before dispatching new commands.
- **Dagster:** `ReexecutionOptions` loads a prior run into a new execution context.
- **Step Functions:** task-token callback pattern resumes a suspended state machine.

## Proposed Design

Three small additions — one per layer — composed by a single helper.

### 1. RunManager: open an existing run

```ts
interface ResumeHandle {
  runDir: RunDirectory;           // reopened, not created
  snapshot: EngineSnapshot;        // from replay(readEventLog(runDir))
  lastSeq: number;                 // max seq in the log
  tokenCounter: number;            // max numeric suffix of any token id
}

RunManager.openExistingRun(runId: string): Promise<ResumeHandle>
```

`tokenCounter` is derived from the log (parse `token:created.tokenId` suffixes) rather than persisted separately — the log is already the source of truth.

### 2. EventLogger: continue appending

```ts
createEventLoggerFromExisting(runDir: string, lastSeq: number): EventLogger
```

Seeds the internal `seq` counter at `lastSeq` so the next `append()` yields `lastSeq + 1`. Append semantics and serialization otherwise unchanged from the fresh-start path.

### 3. Engine: accept prior state

```ts
interface EngineOptions {
  // ...existing fields...
  resumeFrom?: {
    snapshot: EngineSnapshot;
    lastSeq: number;
    tokenCounter: number;
  };
}
```

When `resumeFrom` is present, `WorkflowEngine.start()`:

1. Skips `getStartNodes()` seeding — tokens come from `snapshot.tokens`.
2. Restores `globalContext`, `retryBudgets`, `completedResults` from the snapshot.
3. Emits a `run:resumed` event (see below) as the first new event.
4. Re-dispatches every token whose state is `pending` (and later `waiting` after 04 lands). Tokens in `complete` / `skipped` are terminal — no per-node skip logic needed in `executeToken`.

### The `run:resumed` event

```ts
{ type: "run:resumed"; v: 1; resumedAtSeq: number }
```

Folded by `replay()` as a no-op marker (like `run:start`, no state mutation). Having it in the log makes "this run was resumed at seq N" directly observable in `markflow show --events`.

### Append-vs-fork decision

**Append to the existing log** rather than forking a new run id with a `resumedFrom` link. One run = one log = one snapshot. Matches the event-sourced model already established by 18 and removes the need for cross-run projection.

(If forking is ever wanted for audit reasons, it can be layered on top: copy the log to a new run dir, then resume there. Fork is strictly more work than append, so append is the right default.)

### CLI surface

This idea exposes no new user-facing command on its own. 04 adds `markflow approve` and 05 adds `markflow resume`; both become thin wrappers around:

```ts
const handle = await runManager.openExistingRun(id);
// feature-specific: append approval:decided / run:resumed / token:reset / etc.
await executeWorkflow(workflow, { ...opts, resumeFrom: handle });
```

## Implementation Approach

1. Add `tokenCounter` extraction to `replay()` — or a small sibling helper that scans events for max token suffix. Decide whether to return it from `replay` or compute in `openExistingRun`.
2. Implement `RunManager.openExistingRun(id)` in `src/core/run-manager.ts`.
3. Implement `createEventLoggerFromExisting(runDir, lastSeq)` in `src/core/event-logger.ts`.
4. Add `resumeFrom` to `EngineOptions` in `src/core/types.ts`; branch `WorkflowEngine.start()` in `src/core/engine.ts`.
5. Add `run:resumed` to `EngineEventPayload` and a no-op case in `replay()`.
6. Tests: round-trip (run → crash mid-flight → resume → complete), snapshot equivalence (fresh run vs. resumed run both yield the same final snapshot).

## What It Extends

- `RunManager` (new `openExistingRun`)
- `EventLogger` (new `createEventLoggerFromExisting`)
- `EngineOptions` (new `resumeFrom`)
- `EngineEventPayload` (new `run:resumed`)
- `replay()` (new case for `run:resumed`)
- `WorkflowEngine.start()` (branch on `resumeFrom`)

## Key Files

- `src/core/run-manager.ts`
- `src/core/event-logger.ts`
- `src/core/engine.ts`
- `src/core/replay.ts`
- `src/core/types.ts`

## Open Questions

- **Schema drift.** If the workflow file changed between the original run and the resume, the replayed token nodeIds may no longer exist in the graph. Detect and refuse? Warn? Allow with `--force`? Recommend: validate that every `tokenId`'s `nodeId` still exists, error otherwise. Deeper semantic drift (step logic changed) is out of scope — the user opted in by resuming.
- **`token:reset` event.** Idea 05's `--rerun step-a,step-b` needs a way to move completed tokens back to `pending`. Cleanest is a new `token:reset` event, appended before `run:resumed`, that `replay()` tolerates by clearing `edge`/`result` and flipping state back. Spec this here or in 05? Recommend: here, since it's a primitive — 05 just exposes the flag.
- **Concurrent resumes.** What if two processes both call `openExistingRun` on the same id? First-writer-wins at the fs level (event append serialization) but the second writer's snapshot is stale. Needs a lock file or a CAS check on `lastSeq` at first append. Flag as follow-up.

## Downstream unblocks

- **04 Approval nodes** — suspend = exit after emitting `step:waiting`; resume = `openExistingRun` + append `approval:decided` + execute with `resumeFrom`.
- **05 Resume-from-failure** — `markflow resume <id>` = `openExistingRun` + execute with `resumeFrom`. Optionally appends `token:reset` events when `--rerun` is passed.
