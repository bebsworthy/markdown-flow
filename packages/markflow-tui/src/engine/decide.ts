// src/engine/decide.ts
//
// Impure bridge that decides a pending approval by invoking the
// `markflow` engine. Mirrors the CLI `approve` command's sequence:
//   1. Replay the event log to confirm a matching `step:waiting` is open.
//   2. Open an exclusive on-disk handle via `RunManager.openExistingRun`.
//   3. Parse the workflow source and call `executeWorkflow` with
//      `{ resumeFrom, approvalDecision }`.
//   4. Map every failure mode into a typed `ApprovalSubmitResult`.
//
// PURITY NOTE: this file is engine-adjacent IO, allowed `node:path` +
// `markflow` imports — same envelope as `adapter.ts`. It is NOT listed in
// the purity-probe `files[]` array.

import { dirname, join } from "node:path";
import {
  createRunManager,
  executeWorkflow,
  parseWorkflow,
  readEventLog,
  RunLockedError,
  type EngineEvent,
  type RunManager,
} from "markflow-cli";
import type { ApprovalSubmitResult } from "../approval/types.js";

export interface DecideApprovalOptions {
  readonly runsDir: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly choice: string;
  readonly decidedBy?: string;
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
 * Decide a pending approval. Returns a typed result; never throws for
 * expected error modes (lock contention, stale gate, invalid choice).
 * Only unexpected failures surface as `{kind:"error"}`.
 */
export async function decideApproval(
  opts: DecideApprovalOptions,
): Promise<ApprovalSubmitResult> {
  const {
    runsDir,
    runId,
    nodeId,
    choice,
    decidedBy,
    manager,
    execute = executeWorkflow,
    parse = parseWorkflow,
    readLog = readEventLog,
  } = opts;

  const runDir = join(runsDir, runId);

  // --- 1. Validate the gate is still open -----------------------------------
  let events: readonly EngineEvent[];
  try {
    events = await readLog(runDir);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let lastWaiting:
    | Extract<EngineEvent, { type: "step:waiting" }>
    | undefined;
  let decidedAfter = -1;
  for (const e of events) {
    if (e.type === "step:waiting" && e.nodeId === nodeId) {
      lastWaiting = e;
      decidedAfter = -1;
    } else if (e.type === "approval:decided" && e.nodeId === nodeId) {
      decidedAfter = e.seq;
    }
  }
  if (!lastWaiting || (decidedAfter > -1 && decidedAfter > lastWaiting.seq)) {
    return { kind: "notWaiting" };
  }
  if (!lastWaiting.options.includes(choice)) {
    return { kind: "invalidChoice" };
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

  // --- 3. Resolve workflow + execute ---------------------------------------
  try {
    const meta = await rm.getRun(runId);
    if (!meta) {
      return { kind: "error", message: `meta.json missing for ${runId}` };
    }
    const workflow = await parse(meta.sourceFile);
    const workspaceDir = dirname(runsDir);

    await execute(workflow, {
      runsDir,
      workspaceDir,
      resumeFrom: handle,
      approvalDecision: {
        nodeId,
        choice,
        ...(decidedBy !== undefined ? { decidedBy } : {}),
      },
    });
    return { kind: "ok" };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // `executeWorkflow` releases the handle in its own `finally`; we still
    // call it here to be idempotent on error paths that never reached the
    // engine's own teardown.
    try {
      await handle.release();
    } catch {
      /* release is idempotent; swallow. */
    }
  }
}
