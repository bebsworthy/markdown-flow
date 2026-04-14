# 12 — Artifact Management

**Tier:** Differentiating | **Effort:** Quick win (1-2 days) | **Priority:** Medium

## Problem

Steps produce files (reports, build outputs, data exports) that need to persist beyond the run working directory and be accessible to other steps or external consumers. Currently, files in `workdir/` are ephemeral and unstructured.

## Reference Implementations

- **GitHub Actions:** `actions/upload-artifact` / `actions/download-artifact` with retention policies
- **Argo Workflows:** S3/GCS artifact storage with input/output artifact declarations
- **Airflow:** XCom for small data, external storage for large artifacts

## Proposed Design

### Sentinel protocol

Steps declare artifacts via stdout:

```
ARTIFACT: {"name": "report", "path": "analysis.md"}
ARTIFACT: {"name": "build", "path": "dist/", "type": "directory"}
```

### Artifact storage

Artifacts follow the sidecar pattern established by idea 18 for step output: large out-of-band data lives on disk, the log carries an index event. Files are keyed by the `stepSeq` of the owning `step:start`, plus the artifact `name`:

```
runs/<timestamp>/
  events.jsonl
  artifacts/
    0007-report/analysis.md      # step with seq 0007, artifact "report"
    0007-build/dist/...
    0023-report/analysis.md      # second loop iteration of the same step
```

Why key on `stepSeq` (not step name alone): loops and retries mean the same node executes multiple times per run; bare-name keys would collide. Same rationale 18 used for output sidecar files.

### Event model (event-sourced log, idea 18)

```ts
{
  type: "artifact:created";
  v: 1;
  stepSeq: number;
  name: string;
  path: string;         // relative to run dir, e.g. "artifacts/0007-report/analysis.md"
  artifactType: "file" | "directory";
}
```

Persisted. Emitted by the step runner on each `ARTIFACT:` sentinel, after copying the file/directory into place (write-ahead order: copy → append event → dispatch). `replay()` folds these into a projection available from the snapshot.

`StepResult.artifacts` is **not** added — artifacts are a projection of the log, not step-result data. Consumers read them from the snapshot or from a `markflow show --artifacts` reader over `events.jsonl`.

### Accessing artifacts from downstream steps

```bash
# Environment variable points to artifact directory
echo $MARKFLOW_ARTIFACTS/report/analysis.md

# Or reference via template
cat {{ ARTIFACTS.report.path }}
```

### CLI access

```bash
# List artifacts for a run
markflow show <run-id> --artifacts

# Extract an artifact
markflow artifact <run-id> <name> [--output ./local-dir]
```

## Implementation Approach

1. Add `ARTIFACT:` sentinel parsing in `stream-parser.ts`.
2. In the step runner, on each parsed sentinel: copy the referenced file/directory to `runs/<id>/artifacts/<stepSeq>-<name>/…`, then append an `artifact:created` event to the log (append → mutate → dispatch order from idea 18).
3. Add a replay case for `artifact:created` that maintains an `artifacts` map on the snapshot (projection only — no `StepResult` mutation).
4. Expose artifact paths in template context as `ARTIFACTS.<name>.path`, populated from the replayed snapshot.
5. Add `--artifacts` flag to `show` command and optional `artifact` command, both backed by replay of `events.jsonl`.

## What It Extends

- Stream parser in `runner/stream-parser.ts` (new sentinel)
- `EngineEventPayload` in `types.ts` (new `artifact:created` variant)
- `EngineSnapshot` (new `artifacts` projection map)
- `replay()` (new fold case)
- Template context (new `ARTIFACTS` surface)
- Run directory structure
- CLI `show` command

## Key Files

- `src/core/runner/stream-parser.ts`
- `src/core/types.ts`
- `src/core/template.ts`
- `src/core/run-manager.ts`
- `src/cli/commands/show.ts`

## Open Questions

- Should artifacts support retention policies (auto-delete after N days)?
- Size limits on artifacts?
- Should artifact paths be relative to workdir or absolute?
