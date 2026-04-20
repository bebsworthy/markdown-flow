// test/engine/helpers.ts
//
// Test-only helpers for building tiny run-dir fixtures. Modelled on
// `packages/markflow/test/core/run-manager-watch.test.ts` and
// `packages/markflow/test/core/tail-event-log.test.ts`.
//
// NOTE: this is a TEST file — it is allowed to touch `node:fs`. The SUT
// (`src/engine/*`) must not. See `test/state/purity.test.ts`.

import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EngineEvent,
  EngineEventPayload,
  RunStatus,
} from "markflow-cli";

export interface MakeRunOptions {
  status?: RunStatus;
  completedAt?: string;
  workflowName?: string;
  startedAt?: string;
}

/** Create a fresh `runs/` parent directory under tmpdir(). */
export async function makeRunsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "markflow-tui-engine-"));
}

/**
 * Create a minimal valid run directory so `RunManager.getRun` returns a
 * non-null snapshot. Returns the absolute path of the new run dir.
 */
export async function makeRun(
  runsDir: string,
  runId: string,
  opts: MakeRunOptions = {},
): Promise<string> {
  const runPath = join(runsDir, runId);
  await mkdir(runPath, { recursive: true });
  const meta = {
    workflowName: opts.workflowName ?? `wf-${runId}`,
    sourceFile: `/fake/${runId}.md`,
    startedAt: opts.startedAt ?? "2026-01-01T00:00:00.000Z",
    status: opts.status ?? "running",
    ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
  };
  await writeFile(
    join(runPath, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
  await writeFile(join(runPath, "events.jsonl"), "", "utf-8");
  return runPath;
}

/** Append a JSON-lines event to a run's `events.jsonl`. */
export async function appendEvent(
  runDir: string,
  event: EngineEvent,
): Promise<void> {
  await appendFile(
    join(runDir, "events.jsonl"),
    JSON.stringify(event) + "\n",
    "utf-8",
  );
}

/** Best-effort cleanup of a list of directories. */
export async function cleanup(dirs: string[]): Promise<void> {
  await Promise.all(
    dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})),
  );
}

// ---------------------------------------------------------------------------
// Event constructors — keep tests readable
// ---------------------------------------------------------------------------

export function stepStart(
  seq: number,
  nodeId = `n${seq}`,
  tokenId = `t${seq}`,
): EngineEvent {
  const payload: EngineEventPayload = { type: "step:start", nodeId, tokenId };
  return { ...payload, seq, ts: new Date().toISOString() };
}

export function workflowComplete(seq: number): EngineEvent {
  const payload: EngineEventPayload = { type: "workflow:complete", results: [] };
  return { ...payload, seq, ts: new Date().toISOString() };
}

export function workflowError(seq: number, error = "boom"): EngineEvent {
  const payload: EngineEventPayload = { type: "workflow:error", error };
  return { ...payload, seq, ts: new Date().toISOString() };
}

/** Async sleep helper. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
