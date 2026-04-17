// src/engine/resume.ts
//
// Impure bridge that resumes a suspended/errored run by invoking the
// `markflow` engine. Mirrors the CLI `resume` command's sequence:
//   1. Replay the event log to confirm the run is resumable.
//   2. Open an exclusive on-disk handle via `RunManager.openExistingRun`.
//   3. Append one `token:reset` event per selected rerun node.
//   4. Append a single `global:update` event if inputOverrides is non-empty.
//   5. Call `executeWorkflow({ resumeFrom, runsDir, workspaceDir })`.
//   6. Map every failure mode into a typed `ResumeSubmitResult`.
//
// PURITY NOTE: this file is engine-adjacent IO, allowed `node:path` +
// `markflow` imports — same envelope as `adapter.ts` and `decide.ts`. It is
// NOT listed in the purity-probe `files[]` array.

import { dirname, join } from "node:path";
import {
  createRunManager,
  executeWorkflow,
  parseWorkflow,
  readEventLog,
  replay,
  RunLockedError,
  type EngineEvent,
  type RunManager,
} from "markflow";
import type { ResumeSubmitResult } from "../resume/types.js";

export interface ResumeRunOptions {
  readonly runsDir: string;
  readonly runId: string;
  readonly rerunNodes: readonly string[];
  readonly inputOverrides: Readonly<Record<string, string>>;
  /** Test seam — defaults to `createRunManager(runsDir)`. */
  readonly manager?: RunManager;
  /** Test seam — defaults to the real `executeWorkflow`. */
  readonly execute?: typeof executeWorkflow;
  /** Test seam — defaults to the real `parseWorkflow`. */
  readonly parse?: typeof parseWorkflow;
  /** Test seam — defaults to the real `readEventLog`. */
  readonly readLog?: typeof readEventLog;
}

/**
 * Resume a run. Returns a typed result; never throws for expected error
 * modes (lock contention, stale state, unknown rerun target). Only
 * unexpected failures surface as `{kind:"error"}`.
 */
export async function resumeRun(
  opts: ResumeRunOptions,
): Promise<ResumeSubmitResult> {
  const {
    runsDir,
    runId,
    rerunNodes,
    inputOverrides,
    manager,
    execute = executeWorkflow,
    parse = parseWorkflow,
    readLog = readEventLog,
  } = opts;

  const runDir = join(runsDir, runId);

  // --- 1. Validate the run is resumable -----------------------------------
  let events: readonly EngineEvent[];
  try {
    events = await readLog(runDir);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  let snapshotStatus: string;
  try {
    snapshotStatus = replay([...events]).status;
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (snapshotStatus !== "error" && snapshotStatus !== "suspended") {
    return { kind: "notResumable", status: snapshotStatus };
  }

  // --- 2. Acquire the exclusive handle -------------------------------------
  const rm: RunManager = manager ?? createRunManager(runsDir);
  let handle;
  try {
    handle = await rm.openExistingRun(runId);
  } catch (err) {
    if (err instanceof RunLockedError) {
      return { kind: "locked", runId: err.runId, lockPath: err.lockPath };
    }
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // --- 3. Resolve workflow + append events + execute ----------------------
  try {
    const meta = await rm.getRun(runId);
    if (!meta) {
      return { kind: "error", message: `meta.json missing for ${runId}` };
    }
    const workflow = await parse(meta.sourceFile);

    // Build nodeId → tokenId lookup from the exclusive snapshot.
    const tokensByNode = new Map<string, string>();
    for (const [id, tok] of handle.snapshot.tokens) {
      tokensByNode.set(tok.nodeId, id);
    }

    for (const nodeId of rerunNodes) {
      const tokenId = tokensByNode.get(nodeId);
      if (!tokenId) {
        return { kind: "unknownNode", nodeId };
      }
      await handle.runDir.events.append({
        type: "token:reset",
        v: 1,
        tokenId,
      });
    }

    if (Object.keys(inputOverrides).length > 0) {
      await handle.runDir.events.append({
        type: "global:update",
        keys: Object.keys(inputOverrides),
        patch: { ...inputOverrides },
      });
    }

    const workspaceDir = dirname(runsDir);
    await execute(workflow, {
      runsDir,
      workspaceDir,
      resumeFrom: handle,
    });
    return { kind: "ok" };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await handle.release();
    } catch {
      /* release is idempotent; swallow. */
    }
  }
}
