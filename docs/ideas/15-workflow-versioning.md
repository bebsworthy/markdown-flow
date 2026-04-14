# 15 — Workflow Versioning

**Tier:** Differentiating | **Effort:** Quick win (1 day) | **Priority:** Low-Medium

## Problem

When debugging a failed run, users need to know which version of the workflow file was executed. If the file has been edited since the run, comparing current vs. executed definitions is impossible.

## Reference Implementations

- **Temporal:** Worker versioning (pin in-flight workflows to code version)
- **Durable Functions:** Automatic version isolation
- **HubSpot:** Version history with rollback

## Proposed Design

### Automatic content hashing

On every run, hash the workflow file content. Idea 18 made `run:start` the identity-of-record for a run (demoting `meta.json` to a write-through cache), so the hash and snapshot path belong on the event payload:

```ts
{
  type: "run:start";
  v: 1;
  workflowName: string;
  sourceFile: string;
  sourceHash: string;          // NEW — sha256 of the workflow source
  sourceSnapshotPath: string;  // NEW — relative path to the in-run snapshot
  gitCommit?: string;          // NEW (optional) — HEAD commit if in a git repo
  inputs: Record<string, unknown>;
  configResolved: Record<string, unknown>;
}
```

`meta.json` still holds these fields as a cache for fast `markflow ls`, updated on `run:start` same as any other cached field. Replay is the source of truth if they disagree.

Example cached `meta.json`:

```json
{
  "id": "2026-04-13T...",
  "workflowName": "Deploy Pipeline",
  "sourceFile": "deploy.md",
  "sourceHash": "sha256:a1b2c3...",
  "sourceSnapshotPath": "runs/<id>/workflow.md"
}
```

### Snapshot storage

Copy the workflow file into the run directory so the exact version is preserved:

```
runs/<timestamp>/
  workflow.md      # Snapshot of the workflow at execution time
  meta.json
  events.jsonl
```

### CLI diff

```bash
# Compare current workflow with what was run
markflow diff <run-id>

# Show the workflow as it was when run
markflow show <run-id> --source
```

### Schema-drift interaction (idea 19)

Idea 19 guards resume by checking every replayed `tokenId.nodeId` still exists in the current workflow. Workflow versioning adds a complementary, coarser check: if the current file's `sha256` differs from the `sourceHash` on `run:start`, the workflow *definitely* changed — warn and require `--force` on resume. The existing node-ID check catches cases where the file changed in ways that matter; the hash check catches cases where it changed at all. Both together give the user a clear signal before resuming against drifted state.

## Implementation Approach

1. In `run-manager.ts:createRun`, compute SHA-256 of the workflow source and include it (plus `sourceSnapshotPath` and optional `gitCommit`) on the `run:start` event payload.
2. Copy the workflow file to the run directory as `workflow.md`.
3. Update `meta.json` write-through cache with `sourceHash` after `run:start` lands.
4. Add `sourceHash` to `RunInfo` in `types.ts` (populated by `replay()` from `run:start`).
5. Optionally add a `diff` CLI command or `--source` flag to `show`.
6. Wire the drift check into 19's resume path: compare current file hash against `run:start.sourceHash`; on mismatch, error unless `--force`.

## What It Extends

- `RunManager` / `createRun` in `run-manager.ts`
- `RunInfo` in `types.ts`
- CLI `show` command

## Key Files

- `src/core/run-manager.ts`
- `src/core/types.ts`
- `src/cli/commands/show.ts`

## Open Questions

- Should the snapshot include resolved config and .env as well?
- Git integration (store commit hash if in a git repo)?
