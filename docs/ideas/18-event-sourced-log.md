# 18 — Event-Sourced Run Log

**Tier:** Foundation | **Effort:** Medium (3-5 days) | **Priority:** Highest (unblocks 04, 05, 09, 17)

## Problem

The current run log (`context.jsonl`) is a **completion log**: one `StepResult` appended per step after it finishes. It records *what ended*, not *what happened*. That is enough for `markflow show` and post-mortem inspection, but insufficient for any feature that needs to reconstruct in-flight engine state:

- Which tokens exist, at which nodes, in which state (`pending`/`running`/`waiting`).
- Retry-budget consumption per edge.
- Accumulated global context.
- Routing decisions and fan-out/fan-in timing.

Because of this, the engine cannot be suspended and resumed. Several planned features (approval nodes, resume-from-failure, data lineage, OpenTelemetry export) all bottom out on the same missing substrate.

## Goal

Turn the run log into an append-only event stream that is **sufficient to fold back into a live `EngineSnapshot`**. Ship this as a pure internal refactor — no new user surface, no Mermaid or config changes, no CLI additions beyond what `markflow show` already does.

## Non-goals

- Implementing suspend/resume (that's idea 04 and 05).
- Distributed/multi-process coordination.
- Changing the Mermaid or config syntax.
- OTel export (idea 09) — the event stream is the enabler, export is separate.
- Snapshot compaction of old runs — linear replay is sub-millisecond at expected scale; revisit when evidence demands.

## Proposed Design

### Log becomes the event stream

Replace the per-step completion log with an append-only stream of `EngineEvent` records. The existing `EngineEvent` union in `types.ts` is already close to the right schema; the missing pieces are the state-mutating events that today live only in engine memory.

### Events to add

Beyond today's `step:start`, `step:complete`, `route`, `retry:increment`, `retry:exhausted`, `step:retry`, `step:timeout`, `workflow:complete`, `workflow:error`:

- `run:start` — `{ v: 1, workflowName, sourceFile, inputs, configResolved }`. First record of every log; replaces `meta.json` as the source of truth for workflow identity. `v` is the only version tag per run; `replay()` asserts `v === 1` or throws `UnsupportedLogVersionError`.
- `token:created` — `{ tokenId, nodeId, generation }`. (A `parentTokenId` field is *not* added in this phase; fan-out lineage is a concern for ideas 07/17 and can extend this event when needed.)
- `token:state` — `{ tokenId, from: TokenState, to: TokenState }`
- `global:update` — `{ keys: string[], patch: Record<string, unknown> }` (patch only, for compactness)
- `output:ref` — `{ seq, tokenId, nodeId, stream: "stdout" | "stderr", path }`. Emitted at `step:start`, not `step:complete`, so that a crash mid-step still leaves a log record pointing at the sidecar file (otherwise the file is an orphan with no event referencing it). `bytes` is deliberately *not* on the event — consumers stat the file at read time. `seq` is the `seq` of the corresponding `step:start` — it's the key that uniquely identifies a single step execution, including across loop iterations. See "Step output" below.

`step:output` remains an in-memory event for live consumers (TUI, handlers) but is **not** persisted to `events.jsonl` — it's redirected to sidecar files. An opt-in `--verbose-log` flag can inline it for debugging.

Every event carries `{ seq: number, ts: string }`. `seq` is a monotonically increasing integer per run — cheap to assign at append time, invaluable for ordering and for idempotent replay.

### Step output (sidecar files)

Agent steps produce kilobytes-to-megabytes of stdout. Inlining bloats the event log and forces `replay()` to read data it never uses — replay cares about state, not transcripts. So the log is the *index*; content lives on the side:

Files are keyed by the `seq` of the `step:start` that opened them, plus the `nodeId` for human readability:

```
runs/<id>/
  events.jsonl
  output/
    0007-build.stdout.log     # first visit to `build`
    0007-build.stderr.log
    0023-build.stdout.log     # second visit (loop iteration 2)
    0039-build.stdout.log     # third visit
```

Why key on `seq` and not `tokenId`:
- A token traverses multiple nodes; `<tokenId>.log` would concatenate unrelated transcripts.
- Loops mean the same `nodeId` is executed multiple times per run; `seq` distinguishes each visit naturally since every `step:start` gets a fresh, monotonic `seq`.
- Retries (same node, same loop iteration, new attempt) also get a fresh `seq`, so they land in distinct files without extra bookkeeping.

`markflow show --output <seq>` dereferences an `output:ref` event to the file. Deleting `output/` does not corrupt replay — only the transcript is lost.

### Write-ahead ordering

**The emission order is: append → mutate → dispatch handlers.**

1. Append the event to `events.jsonl` (and await it).
2. Apply the in-memory state mutation.
3. Dispatch the event to registered handlers.

Rationale: if the process dies between append and mutate, replay reconstructs exactly the state the engine would have reached. The inverse ordering (mutate first) risks a ghost state that exists in memory but not in the log — unrecoverable. Handlers run last so they observe mutated state, consistent with current behavior.

This is a hard rule, enforced by code review and by the emission unit tests (see Testing Strategy §2).

**Performance note.** Awaiting the append per event means each state change pays one fs write. On a wide fan-out, writes serialize through the single log writer (see §Ordering guarantees). On local NVMe the latency is negligible, but the writer is a serialization point *by design*. If it becomes a bottleneck, the fix is to batch multiple events into one `write()` call — not to introduce parallel writers, which would break `seq` ordering.

### File layout

```
runs/<id>/
  events.jsonl        # new — the event stream
  meta.json           # kept, but derived fields (status, completedAt) become a cache of the fold
  workdir/
```

`context.jsonl` is renamed to `events.jsonl`. There is no backwards-compat shim — this is pre-1.0.

### Replay

A pure function:

```ts
function replay(events: EngineEvent[]): EngineSnapshot
```

`EngineSnapshot` is a new data-only type in `types.ts`:

```ts
interface EngineSnapshot {
  tokens: Map<string, Token>;
  retryBudgets: Map<string, { count: number; max: number }>;
  globalContext: Record<string, unknown>;
  completedResults: StepResult[];
  status: "running" | "complete" | "error";
  // idea 04 will add "waiting" when approval nodes land
}
```

It deliberately excludes non-serializable engine internals (child processes, handler refs, file handles). The engine exposes a test-only `getSnapshot()` accessor that returns exactly this shape — that's what round-trip tests compare against.

The fold is deterministic: same events → same snapshot. Two rules guarantee this:

- **Replay never reads the clock.** All timestamps in `completedResults` come from event `ts` fields verbatim. Any use of `Date.now()` inside `replay()` is a bug.
- **Replay is strict.** Unknown `tokenId` in `token:state`, `retry:increment` against an unregistered edge, or out-of-order `seq` throw `InconsistentLogError` — replay never silently papers over a corrupt log.

`RunManager.getRun(id)` becomes `replay(readAll(events.jsonl))` projected into `RunInfo`. The derived `steps: StepResult[]` that the CLI consumes today falls out of the fold.

### Writer

A single `EventLogger` owned by the engine replaces the current `ContextLogger`. Every place in `engine.ts` that emits an `EngineEvent` to handlers also appends it to the log. The emission path follows the write-ahead rule above: **append → mutate → dispatch**.

The step runner is responsible for writing sidecar output files. At `step:start`, the runner resolves the sidecar path (`output/<seq>-<nodeId>.{stdout,stderr}.log`), opens write streams, and tees the child process's stdout/stderr into them as the step runs. The sidecar path is authoritative in the `output:ref` event; the runner does not need to coordinate with the logger beyond knowing the `seq` that was assigned to the corresponding `step:start`.

### Ordering guarantees

Within a single-process engine, Node's `appendFile` is sufficient — we serialize event assignment of `seq` through a small promise chain. No fsync-per-event; crash recovery tolerates a truncated last line.

## Implementation Approach

1. **Audit `EngineEvent`.** Walk `engine.ts` and identify every in-memory state mutation that is not currently emitted. Add the missing event variants to `types.ts`.
2. **Introduce `EventLogger`** next to `ContextLogger` (don't delete yet). Wire it through `RunDirectory`. Writer assigns `seq`.
3. **Emit the new events** from the engine at the points the state changes. Unit-test each emission in isolation.
4. **Write `replay()`.** Pure function, no I/O. Exhaustive switch on event `type`.
5. **Property test:** for a suite of workflows, run the engine to completion capturing both the live final state and the event log; assert `replay(log)` deep-equals live state.
6. **Cut over readers.** `RunManager.getRun`, `markflow show`, `markflow ls` all consume `replay()` output. Delete `ContextLogger`.
7. **Update `markflow show`** to optionally render the event timeline (behind a `--events` flag). Useful free debugging affordance.

Keep each step shippable — the engine continues to work after step 3 even if replay isn't wired yet.

## Testing Strategy

The correctness bar for this refactor is: **`replay(log)` must equal live engine state, for every workflow, at every point in time.** Four layers of tests:

### 1. Fold unit tests (`replay.test.ts`)

Pure-function tests for each `EngineEvent` variant: hand-craft a short event sequence, assert the resulting `EngineSnapshot`. One test per variant plus edge cases:

- Empty log → empty snapshot.
- `token:state` to a terminal state removes the token from `tokens` and appends to `completedResults`.
- `retry:increment` past `max` + `retry:exhausted` leaves the budget at max and marks the edge dead.
- `global:update` patches are applied in order; later keys overwrite earlier.
- Out-of-order `seq` throws (replay is strict; the writer is the ordering authority).

### 2. Emission unit tests (`engine.events.test.ts`)

For every in-memory mutation in `engine.ts`, assert the corresponding event is emitted **before** handler dispatch and **with the mutated value, not the pre-mutation one**. Drive via a stub `EventLogger` that records calls. Failure mode to guard: an event emitted from a stale closure that reflects pre-mutation state.

### 3. Round-trip property tests (`replay.roundtrip.test.ts`)

The load-bearing test. For a suite of representative workflows (linear, fan-out/fan-in, retries, agent+script mix, failure paths), run the engine to completion while capturing:

- The final live `EngineSnapshot` (export a test-only accessor).
- The full `events.jsonl` written to disk.

Assert `replay(readAll(events.jsonl))` deep-equals the live `EngineSnapshot` (data-only subset — not the full engine object). Include at least one workflow that exercises every event variant — coverage gate.

Extend to **intermediate** snapshots: at each `step:complete`, capture live state and compare against replay of the log-so-far. Catches bugs where the final state happens to match but intermediate states diverge.

### 4. Crash-truncation tests (`replay.truncation.test.ts`)

Simulate a crash mid-write by truncating `events.jsonl` at byte offsets (including mid-line). Replay must either:
- Succeed on the last complete record and ignore a trailing partial line, or
- Throw a specific `TruncatedLogError` — never silently produce a corrupted snapshot.

Parametrize over truncation points: end-of-file, mid-JSON, just-missing-newline.

### Fixtures & harness

- Reuse existing workflow fixtures in `test/fixtures/`; add one dedicated fixture per event variant if not already covered.
- Add a `runEngineCapturing(workflow)` test helper that returns `{ snapshot, events }` — the round-trip tests will all use it.
- No mocking of the filesystem for round-trip tests; use `tmpdir()`. Mocking here defeats the purpose (we're testing the on-disk format).

### Out of scope for this phase

- Concurrent-writer tests (single-process engine; multi-process is a future concern).
- Performance benchmarks for replay (defer until a real run crosses ~10k events).
- Schema-migration tests (nothing to migrate yet; revisit when `v: 2` lands).

### Exit criteria

- 100% variant coverage in the fold unit tests.
- Every workflow in `test/fixtures/` passes the round-trip property test at intermediate + final snapshots.
- Truncation tests pass for all parametrized offsets.
- `npm run test` green; no flakes over 10 consecutive runs.

## What It Extends

- `EngineEvent` union (new variants)
- `ContextLogger` → replaced by `EventLogger`
- `RunManager` (reads via replay)
- `engine.ts` emission sites

## Key Files

- `src/core/types.ts`
- `src/core/engine.ts`
- `src/core/context-logger.ts` → `event-logger.ts`
- `src/core/run-manager.ts`
- `src/core/replay.ts` (new)
- `src/cli/commands/show.ts`

## Open Questions

All prior open questions are resolved inline in the design above:

- **Step output persistence** → sidecar files + `output:ref` event (see "Step output").
- **Schema versioning** → `v: 1` on `run:start`, asserted by `replay()`.
- **Snapshot compaction** → out of scope (see Non-goals).
- **Crash ordering** → write-ahead rule (see "Write-ahead ordering").

Remaining question worth flagging before build:

- `meta.json` vs. `run:start`: do we delete `meta.json` entirely and derive everything from the log, or keep it as a cache for fast listing in `markflow ls`? Reading a one-line JSON file is faster than opening and tailing `events.jsonl` to find `run:start` and the last `workflow:complete`. Recommend keeping `meta.json` as a write-through cache updated on `run:start` and terminal events, with replay as the source of truth when they disagree.

## Downstream unblocks

- **04 Approval nodes** — add `waiting` token state + `step:waiting` / `step:resumed` events; suspend = exit after emit, resume = replay + re-enter scheduler.
- **05 Resume-from-failure** — replay up to the failure event, then re-dispatch pending tokens.
- **09 OpenTelemetry** — map events to spans in a separate exporter; no engine changes needed.
- **17 Data lineage** — `global:update` events already carry the keys that changed, per step.
