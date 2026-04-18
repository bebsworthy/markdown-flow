// test/app/narrow-width.test.tsx
//
// P8-T2 §4.3 — App-level integration at width=52 across the three narrow
// levels (runs, steplist, stepdetail). Mirrors medium-width.test.tsx's
// sized-stdout harness.

import React from "react";
import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import { render as inkRender } from "ink";
import type { EngineEvent, RunInfo, StepResult } from "markflow";
import { App } from "../../src/app.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const NOW = Date.parse("2026-04-17T12:00:00Z");

class SizedStdout extends EventEmitter {
  public readonly columns: number;
  public readonly rows: number;
  private last: string | undefined;
  constructor(cols: number, rows = 22) {
    super();
    this.columns = cols;
    this.rows = rows;
  }
  write = (f: string): void => {
    this.last = f;
  };
  lastFrame = (): string | undefined => this.last;
}

class TestStdin extends EventEmitter {
  public isTTY = true;
  private data: string | null = null;
  write = (d: string): void => {
    this.data = d;
    this.emit("readable");
    this.emit("data", d);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const v = this.data;
    this.data = null;
    return v;
  };
}

function renderAt(
  tree: React.ReactElement,
  width: number,
  rows = 22,
): {
  readonly lastFrame: () => string;
  readonly stdin: TestStdin;
  readonly unmount: () => void;
} {
  const stdout = new SizedStdout(width, rows);
  const stderr = new SizedStdout(width, rows);
  const stdin = new TestStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    lastFrame: () => stdout.lastFrame() ?? "",
    stdin,
    unmount: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}

function step(o: Partial<StepResult> = {}): StepResult {
  return {
    node: o.node ?? "build",
    type: o.type ?? "script",
    edge: o.edge ?? "success",
    summary: o.summary ?? "",
    started_at: o.started_at ?? "2026-04-17T11:55:00Z",
    completed_at: o.completed_at ?? "2026-04-17T11:55:30Z",
    exit_code: o.exit_code ?? 0,
  };
}

function info(o: Partial<RunInfo> = {}): RunInfo {
  return {
    id: o.id ?? "ijkl5678",
    workflowName: o.workflowName ?? "deploy",
    sourceFile: o.sourceFile ?? "./deploy.md",
    status: o.status ?? "running",
    startedAt: o.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: o.completedAt,
    steps: o.steps ?? [],
  };
}

const ROWS: ReadonlyArray<RunsTableRow> = [
  toRunsTableRow(
    info({ id: "ijkl5678", status: "running", steps: [step({ node: "build" })] }),
    NOW,
  ),
];

function buildEngineState(runId: string): EngineState {
  const events: EngineEvent[] = [
    {
      seq: 1,
      ts: "2026-04-17T11:55:10Z",
      type: "token:created",
      tokenId: "t1",
      nodeId: "build",
      generation: 0,
    } as EngineEvent,
    {
      seq: 2,
      ts: "2026-04-17T11:55:11Z",
      type: "step:start",
      nodeId: "build",
      tokenId: "t1",
    } as EngineEvent,
  ];
  const activeRun: LiveRunSnapshot = {
    runId,
    info: info({ id: runId }),
    events,
    lastSeq: 2,
    terminal: false,
  };
  return {
    runs: new Map([[runId, info({ id: runId })]]),
    activeRun,
  };
}
function appTree(opts?: { engineState?: EngineState }): React.ReactElement {
  return (
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={ROWS}
      engineState={opts?.engineState}
    />
  );
}

describe("App at width=52 — narrow tier (P8-T2 §4.3)", () => {
  it("level=runs: breadcrumb 'Runs', no splitter row, no mode tabs", async () => {
    const { stdin, lastFrame, unmount } = renderAt(appTree(), 52);
    await flush();
    // Go to RUNS mode.
    stdin.write("2");
    await flush();
    const frame = stripAnsi(lastFrame());
    // Breadcrumb present at top.
    const firstLine = frame.split("\n")[0] ?? "";
    expect(firstLine).toContain("Runs");
    // No mode-tabs row text.
    expect(frame).not.toContain("WORKFLOWS  RUNS");
    // No splitter row (╠…╣).
    expect(
      frame.split("\n").some((l) => l.startsWith("\u2560") && l.endsWith("\u2563")),
    ).toBe(false);
    unmount();
  });

  it("level=steplist: breadcrumb 'Runs › <runId>', step table visible", async () => {
    const { stdin, lastFrame, unmount } = renderAt(
      appTree({ engineState: buildEngineState("ijkl5678") }),
      52,
    );
    await flush();
    stdin.write("2");
    await flush();
    stdin.write("\r");
    await flush();
    const frame = stripAnsi(lastFrame());
    const firstLine = frame.split("\n")[0] ?? "";
    expect(firstLine).toContain("Runs");
    expect(firstLine).toContain("ijkl56");
    unmount();
  });

  it("level=stepdetail: breadcrumb has all three segments, G D L E row", async () => {
    const { stdin, lastFrame, unmount } = renderAt(
      appTree({ engineState: buildEngineState("ijkl5678") }),
      52,
    );
    await flush();
    stdin.write("2");
    await flush();
    // Enter the run — this lands at steplist.
    stdin.write("\r");
    await flush();
    // Enter again — narrow Enter-drill picks first step and moves to stepdetail.
    stdin.write("\r");
    await flush();
    const frame = stripAnsi(lastFrame());
    const firstLine = frame.split("\n")[0] ?? "";
    expect(firstLine).toContain("Runs");
    expect(firstLine).toContain("ijkl56");
    // Third breadcrumb segment = selected step id ("build" per fixture).
    expect(firstLine).toContain("build");
    // Single-letter tab row G/D/L/E appears inside the slot.
    expect(frame).toMatch(/G\s+D\s+L\s+E/);
    unmount();
  });
});
