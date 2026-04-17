// test/e2e/fixtures/event-log.ts
//
// Compact event-log fixture builder for the `e2e-engine` layer. Emits a
// valid `runs/<id>/events.jsonl` from a terse shape so tests can attach
// the TUI to synthetic historical runs without executing real scripts.
//
// The output format mirrors `packages/markflow/src/core/event-logger.ts`:
// one JSON object per line, each with a monotonic `seq` starting at 1 and
// an ISO `ts`. The schema is intentionally permissive (we cast through
// `Record<string, unknown>`) so callers can emit event variants the engine
// hasn't documented yet without fighting the public `EngineEvent` union.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EventLogSpecRun {
  readonly runId: string;
  readonly workflowName: string;
  readonly sourceFile: string;
  readonly inputs?: Readonly<Record<string, string>>;
  /**
   * Event payloads in order, **without** `seq`/`ts`. `run:start` is
   * emitted automatically — do not include it here. Each payload is
   * written verbatim after `seq`/`ts` are stamped on.
   */
  readonly events: ReadonlyArray<Record<string, unknown>>;
  /** Seed `ts` — each event is +1 second from the previous. */
  readonly startedAt?: string;
}

export interface WrittenRun {
  readonly runId: string;
  readonly dir: string;
  readonly eventsPath: string;
  readonly eventCount: number;
}

/**
 * Materialise a run directory under `runsDir` with a synthetic
 * `events.jsonl`. Returns metadata the caller can use to assert paths
 * or point the TUI at a specific run.
 */
export async function writeEventLog(
  runsDir: string,
  spec: EventLogSpecRun,
): Promise<WrittenRun> {
  const runDir = path.join(runsDir, spec.runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(runDir, "output"), { recursive: true });

  const baseMs = spec.startedAt
    ? Date.parse(spec.startedAt)
    : Date.parse("2026-01-01T00:00:00Z");

  const runStart: Record<string, unknown> = {
    type: "run:start",
    v: 1,
    runId: spec.runId,
    workflowName: spec.workflowName,
    sourceFile: spec.sourceFile,
    inputs: spec.inputs ?? {},
    configResolved: {},
  };

  const all: ReadonlyArray<Record<string, unknown>> = [
    runStart,
    ...spec.events,
  ];

  const lines = all.map((payload, idx) => {
    const seq = idx + 1;
    const ts = new Date(baseMs + idx * 1000).toISOString();
    return JSON.stringify({ ...payload, seq, ts });
  });

  const eventsPath = path.join(runDir, "events.jsonl");
  await writeFile(eventsPath, `${lines.join("\n")}\n`, "utf8");

  // meta.json — the TUI's fast-path cache. `RunManager.getRun` projects
  // from events, but `listRuns` uses meta.json. Emit a minimal one.
  const meta = {
    id: spec.runId,
    workflowName: spec.workflowName,
    sourceFile: spec.sourceFile,
    startedAt: new Date(baseMs).toISOString(),
    status: terminalStatusFrom(spec.events),
  };
  await writeFile(
    path.join(runDir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  return {
    runId: spec.runId,
    dir: runDir,
    eventsPath,
    eventCount: all.length,
  };
}

function terminalStatusFrom(
  events: ReadonlyArray<Record<string, unknown>>,
): "running" | "complete" | "error" | "cancelled" {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const t = events[i]?.type;
    if (t === "workflow:complete") return "complete";
    if (t === "workflow:error") return "error";
    if (t === "workflow:cancelled") return "cancelled";
  }
  return "running";
}

/** Bulk helper — write several runs under the same `runsDir`. */
export async function writeEventLogs(
  runsDir: string,
  specs: ReadonlyArray<EventLogSpecRun>,
): Promise<ReadonlyArray<WrittenRun>> {
  const out: WrittenRun[] = [];
  for (const spec of specs) {
    out.push(await writeEventLog(runsDir, spec));
  }
  return out;
}
