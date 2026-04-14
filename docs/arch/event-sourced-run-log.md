# Event-Sourced Run Log

Reference for how markflow persists and reconstructs run state. For the design
rationale, see [`docs/ideas/18-event-sourced-log.md`](../ideas/18-event-sourced-log.md).

## What a run directory looks like

```
runs/<id>/
  meta.json            # write-through cache for fast listing
  events.jsonl         # append-only event stream — the source of truth
  workdir/             # step working directory
  output/              # sidecar transcripts, keyed by step:start seq
    0007-build.stdout.log
    0007-build.stderr.log
```

`meta.json` is a cache. If it disagrees with the events, the events win —
`RunManager.getRun` always folds `events.jsonl` through `replay()` to produce
the authoritative `RunInfo`.

## Event envelope

Every line in `events.jsonl` is a JSON object of shape:

```ts
type EngineEvent = EngineEventPayload & { seq: number; ts: string };
```

- `seq` — monotonic integer per run, assigned synchronously by `EventLogger`
  before any `await`. Serves as the ordering key for replay and as the file
  identifier for sidecar transcripts.
- `ts` — ISO-8601 timestamp. Replay never reads the clock; all timestamps in
  reconstructed `StepResult`s come from event `ts` verbatim.

## Event types

Defined in `src/core/types.ts` as the `EngineEventPayload` union.

| Type | When | Mutates snapshot |
|---|---|---|
| `run:start` | first event of every run; carries `v: 1`, workflow identity, resolved inputs and config | no |
| `token:created` | new token enters the graph | adds token (pending) |
| `token:state` | token transitions between states (`pending` / `running` / `complete` / `skipped`) | updates token state |
| `step:start` | a step begins executing | no |
| `output:ref` | announces a sidecar path for a step's stdout/stderr (emitted at `step:start` time, one per stream) | no |
| `step:output` | live stdout/stderr chunk — **not persisted**, in-memory only | no |
| `step:timeout` | a step exceeded its timeout | no |
| `step:retry` | step-level retry is about to sleep and re-run | no |
| `step:complete` | step finished; carries the `StepResult` | appends to `completedResults`; stamps token with edge + result |
| `global:update` | step set keys on the workflow-wide `global` context | merges into `globalContext` |
| `route` | engine chose an outgoing edge | no |
| `retry:increment` | edge-level retry budget consumed | updates retry budget |
| `retry:exhausted` | edge-level retry budget hit its cap | no |
| `workflow:complete` | run finished successfully | sets status to `complete` |
| `workflow:error` | run aborted with an error | sets status to `error` |
| `run:resumed` | first event after a run is reopened via `openExistingRun`; carries `v: 1` and `resumedAtSeq` | no (marker) |
| `token:reset` | completed token moved back to `pending` (e.g. `markflow resume --rerun step-x`) | clears token `edge`/`result`, flips state to `pending` |

`step:output` is the only event type in `NON_PERSISTED_EVENT_TYPES`. It claims a
`seq` (so in-memory consumers see monotonic ordering) but never hits disk —
transcripts live in sidecar files instead. Gaps in persisted `seq` are expected
for this reason.

## Sidecar transcripts

Step stdout/stderr is written to `runs/<id>/output/<stepSeq>-<nodeId>.{stdout,stderr}.log`.

- `stepSeq` is the `seq` of the `step:start` event, zero-padded to 4 digits.
- Keyed on `seq` (not `tokenId` or `nodeId` alone) because tokens traverse
  multiple nodes and loops/retries re-visit the same node — `seq` is the only
  identifier that uniquely names a single step execution.
- The `output:ref` event is emitted **before** the runner opens the write
  streams, so a crash mid-step still leaves a log record pointing at the file.
- Deleting `output/` does not corrupt replay — only transcripts are lost.

## Write-ahead ordering

Every state-mutating event follows **append → mutate → dispatch**:

1. `EventLogger.append(payload)` — stamps `seq`/`ts`, awaits the fs write.
2. In-memory mutation runs.
3. Registered `onEvent` handlers fire.

If the process dies between 1 and 2, replay reconstructs exactly the state the
engine would have reached. The inverse ordering would produce a ghost state
that exists in memory but not on disk — unrecoverable.

Code-level enforcement: mutating emissions go through `WorkflowEngine.record()`,
which takes `(payload, apply)` and guarantees the ordering. Pure notifications
(no mutation) go through `emit()`.

Writes serialize through a single promise chain on the `EventLogger` — this is
by design. `seq` order on disk always matches assignment order.

## Replay

```ts
function replay(events: EngineEvent[]): EngineSnapshot
```

Pure, deterministic fold. Same events in, same snapshot out.

```ts
interface EngineSnapshot {
  tokens: Map<string, Token>;
  retryBudgets: Map<string, { count: number; max: number }>;
  globalContext: Record<string, unknown>;
  completedResults: StepResult[];
  status: "running" | "complete" | "error";
}
```

Replay is **strict**. It throws rather than silently patch over a corrupt log:

- `UnsupportedLogVersionError` — `run:start.v !== 1` or `run:resumed.v !== 1`.
- `InconsistentLogError` — out-of-order `seq`, duplicate `run:start`,
  `token:state` for an unknown token, `token:state.from` disagrees with the
  token's current state, `token:reset` for an unknown token, or `step:output`
  encountered in persisted log.
- `TruncatedLogError` — unparseable line that isn't a trailing crash-truncated
  record. Truncation exactly at end-of-file (no trailing newline on the last
  line) is tolerated: the last partial record is dropped, earlier records are
  returned.

## Resuming a run

Runs are reopened, not forked. One run = one log = one snapshot. The resume
primitive lives across three layers and is composed by callers (idea 04 approval
nodes, idea 05 resume-from-failure). For the design rationale see
[`docs/ideas/19-resume-entry-point.md`](../ideas/19-resume-entry-point.md).

```ts
const handle = await runManager.openExistingRun(id);
// handle: { runDir, snapshot, lastSeq, tokenCounter }
await executeWorkflow(workflow, { ...opts, resumeFrom: handle });
```

- **`RunManager.openExistingRun(id)`** reopens the run directory, replays the
  log into a snapshot, derives `tokenCounter` from `token:created` suffixes, and
  constructs an `EventLogger` seeded at `lastSeq` via
  `createEventLoggerFromExisting`. It also flips `meta.json` back to `running`.
- **`EngineOptions.resumeFrom`** short-circuits `start()`: no fresh `createRun`,
  no `getStartNodes` seeding. Snapshot state (tokens, `globalContext`,
  `completedResults`, retry budgets) is loaded into the engine, and a
  `run:resumed` event is appended as the first new record.
- **Pending tokens** from the snapshot are picked up by `runLoop` on the next
  tick — no special dispatch path needed.

### Schema drift

Before appending `run:resumed`, the engine checks that every replayed token's
`nodeId` still exists in `workflow.graph.nodes`. Missing nodes throw
`WorkflowChangedError` and leave the log untouched. Deeper drift (step body
changed but nodeId stable) is out of scope — the user opts in by resuming.

### Token counter continuity

`tokenCounter` is derived from the log rather than persisted separately — the
log is already the source of truth. `extractTokenCounter(events)` parses the
numeric suffix of `token:created.tokenId` and returns the maximum, so new
tokens minted after resume have strictly greater suffixes.

### Concurrent resume

Not guarded. Two processes that both `openExistingRun` the same id will both
seed their seq counters at the same `lastSeq` and race at first append. A lock
file or CAS check is a known follow-up.

## Reading the log

- `readEventLog(runDir)` in `src/core/replay.ts` returns all parsed events,
  tolerating a single truncated trailing line.
- `RunManager.getRun(id)` composes `readEventLog` + `replay` and projects into
  a `RunInfo` for the CLI.
- `markflow show <id> --events` prints the raw event timeline.
- `markflow show <id> --output <seq>` dereferences an `output:ref` event to
  read the sidecar file.

## Compatibility

Pre-1.0: no back-compat shim from the old `context.jsonl`. The `v: 1` tag on
`run:start` is the only schema version. Breaking changes will bump `v` and
extend the union in `UnsupportedLogVersionError.supported`.

## Key files

- `src/core/types.ts` — `EngineEventPayload`, `EngineSnapshot`, error classes.
- `src/core/event-logger.ts` — `seq` assignment, serialized appends,
  `createEventLoggerFromExisting` for resume.
- `src/core/engine.ts` — `record()` / `emit()`, emission sites, resume branch
  in `start()`.
- `src/core/replay.ts` — `replay()`, `readEventLog()`, `extractTokenCounter()`.
- `src/core/run-manager.ts` — run directory lifecycle, `getRun` projection,
  `openExistingRun` → `ResumeHandle`.

## See also

- [`routing-and-retries.md`](routing-and-retries.md) — semantics of the `route`, `retry:*`, and `step:timeout` events.
- [`configuration.md`](configuration.md) — the `configResolved` payload on `run:start`.
- [`templating-and-context.md`](templating-and-context.md) — `global:update` events and the `GLOBAL` surface.
- [`testing-harness.md`](testing-harness.md) — how `WorkflowTest` surfaces events as `result.events`.
