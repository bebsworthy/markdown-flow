// src/engine/run.ts
//
// Impure bridge that starts a fresh run by invoking the `markflow` engine.
// Mirrors the CLI `run` command's sequence:
//   1. Parse the workflow source via `parseWorkflow`.
//   2. Call `executeWorkflow({ runsDir, workspaceDir, inputs, onEvent })`
//      with no `resumeFrom`. The engine mints the run directory itself.
//   3. Invoke `onRunStart(runId)` as soon as we know the runId —
//      preferentially from the first emitted event (tests inject synthetic
//      `run:start` events carrying `runId`), otherwise from the resolved
//      `RunInfo.id`.
//   4. Map every failure mode into a typed `RunWorkflowResult`.
//
// PURITY NOTE: this file is engine-adjacent IO, allowed only `markflow`
// imports — same envelope as `decide.ts` and `resume.ts`. It is NOT listed
// in the purity-probe `files[]` array.

import {
  createRunManager,
  executeWorkflow,
  parseWorkflow,
  RunLockedError,
  type EngineEvent,
  type RunManager,
} from "markflow";
import type { RunWorkflowResult } from "../runStart/types.js";

const MISSING_INPUTS_PREFIX = "Missing required workflow inputs:";

export interface RunWorkflowOptions {
  readonly runsDir: string;
  readonly workspaceDir: string;
  /** Absolute path to the `.md` workflow source. */
  readonly sourceFile: string;
  readonly inputs: Readonly<Record<string, string>>;
  /** Test seam — defaults to `createRunManager(runsDir)`. */
  readonly manager?: RunManager;
  /** Test seam — defaults to the real engine API. */
  readonly execute?: typeof executeWorkflow;
  /** Test seam — defaults to the real `parseWorkflow`. */
  readonly parse?: typeof parseWorkflow;
  /**
   * Callback invoked with the engine's minted runId as soon as it is
   * known, so the caller can switch into `viewing` mode before the run
   * completes. Fires at most once per `runWorkflow` call. Ignored after
   * the run has terminated.
   */
  readonly onRunStart?: (runId: string) => void;
}

function parseMissingInputs(message: string): readonly string[] {
  if (!message.startsWith(MISSING_INPUTS_PREFIX)) return [];
  const tail = message.slice(MISSING_INPUTS_PREFIX.length);
  // Engine format: " KEY1, KEY2. Set them in the environment, …"
  const dot = tail.indexOf(".");
  const list = dot >= 0 ? tail.slice(0, dot) : tail;
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract a runId from a `run:start` event. The engine stamps `runId`
 * onto the first event so the TUI can transition into `viewing` mode
 * as soon as the run directory is minted — long before
 * `executeWorkflow()` resolves at end-of-run.
 */
function pickRunIdFromEvent(event: EngineEvent): string | null {
  if (event.type !== "run:start") return null;
  const maybe = (event as unknown as { runId?: unknown }).runId;
  if (typeof maybe === "string" && maybe.length > 0) return maybe;
  return null;
}

/**
 * Start a fresh run. Returns a typed `RunWorkflowResult`; never throws for
 * expected error modes (parse, missing-input, lock). Unexpected failures
 * surface as `{ kind: "error" }`.
 */
export async function runWorkflow(
  opts: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const {
    runsDir,
    workspaceDir,
    sourceFile,
    inputs,
    manager,
    execute = executeWorkflow,
    parse = parseWorkflow,
    onRunStart,
  } = opts;

  // --- 1. Parse the workflow --------------------------------------------
  let workflow;
  try {
    workflow = await parse(sourceFile);
  } catch (err) {
    return {
      kind: "parseError",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Keep the manager seam reachable for future wiring even if the engine
  // currently mints its own internal manager. Referencing it here also
  // mirrors the documented options shape.
  void manager;

  let capturedRunId: string | null = null;
  const maybeFireStart = (id: string): void => {
    if (capturedRunId !== null) return;
    capturedRunId = id;
    if (onRunStart) onRunStart(id);
  };

  // --- 2. Execute + capture runId via onEvent ---------------------------
  try {
    const info = await execute(workflow, {
      runsDir,
      workspaceDir,
      inputs: { ...inputs },
      onEvent: (event: EngineEvent) => {
        const fromEvent = pickRunIdFromEvent(event);
        if (fromEvent !== null) maybeFireStart(fromEvent);
      },
    });
    if (info && typeof info.id === "string" && info.id.length > 0) {
      maybeFireStart(info.id);
      return { kind: "ok", runId: info.id };
    }
    if (capturedRunId !== null) {
      return { kind: "ok", runId: capturedRunId };
    }
    return { kind: "error", message: "engine returned no run id" };
  } catch (err) {
    if (err instanceof RunLockedError) {
      return { kind: "locked", runId: err.runId, lockPath: err.lockPath };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith(MISSING_INPUTS_PREFIX)) {
      return {
        kind: "invalidInputs",
        missing: parseMissingInputs(message),
      };
    }
    return { kind: "error", message };
  }
}

// Re-reference `createRunManager` so the import is not tree-shaken away;
// the bridge's option shape documents it as a seam even though the
// engine currently mints its own manager internally.
void createRunManager;
