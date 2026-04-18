// test/app/narrow-drill.test.tsx
//
// P8-T2 §4.3 — Narrow-tier Enter-drill + Esc-pop gestures.

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
    type: "script",
    edge: "success",
    summary: "",
    started_at: "2026-04-17T11:55:00Z",
    completed_at: "2026-04-17T11:55:30Z",
    exit_code: 0,
    ...o,
  };
}

function info(o: Partial<RunInfo> = {}): RunInfo {
  return {
    id: o.id ?? "ijkl5678",
    workflowName: o.workflowName ?? "deploy",
    sourceFile: o.sourceFile ?? "./deploy.md",
    status: o.status ?? "running",
    startedAt: "2026-04-17T11:55:00Z",
    steps: [step()],
    ...o,
  };
}

const ROWS: ReadonlyArray<RunsTableRow> = [
  toRunsTableRow(info({ id: "ijkl5678" }), NOW),
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
function appTree(): React.ReactElement {
  return (
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={ROWS}
      engineState={buildEngineState("ijkl5678")}
    />
  );
}

describe("App narrow drill gestures (P8-T2 §4.3)", () => {
  it("Enter drills runs → steplist → stepdetail; Esc pops back", async () => {
    const { stdin, lastFrame, unmount } = renderAt(appTree(), 52);
    await flush();
    stdin.write("2");
    await flush();
    // runs level — breadcrumb is just "Runs".
    {
      const f = stripAnsi(lastFrame());
      const first = f.split("\n")[0] ?? "";
      expect(first).toMatch(/Runs/);
      expect(first).not.toContain("ijkl56");
    }
    // Enter → steplist.
    stdin.write("\r");
    await flush();
    {
      const f = stripAnsi(lastFrame());
      const first = f.split("\n")[0] ?? "";
      expect(first).toContain("ijkl56");
      expect(first).not.toContain("build");
    }
    // Enter again → stepdetail.
    stdin.write("\r");
    await flush();
    {
      const f = stripAnsi(lastFrame());
      const first = f.split("\n")[0] ?? "";
      expect(first).toContain("ijkl56");
      expect(first).toContain("build");
    }
    // Esc → back to steplist.
    stdin.write("\x1b");
    await flush();
    {
      const f = stripAnsi(lastFrame());
      const first = f.split("\n")[0] ?? "";
      expect(first).toContain("ijkl56");
      expect(first).not.toContain("build");
    }
    // Esc → back to runs.
    stdin.write("\x1b");
    await flush();
    {
      const f = stripAnsi(lastFrame());
      const first = f.split("\n")[0] ?? "";
      expect(first).toMatch(/Runs/);
      expect(first).not.toContain("ijkl56");
    }
    unmount();
  });

  it("at width=120 Enter on the step table does NOT drill to a narrow stepdetail", async () => {
    const { stdin, lastFrame, unmount } = renderAt(appTree(), 120);
    await flush();
    stdin.write("2");
    await flush();
    stdin.write("\r"); // Enter on run row → opens viewing mode.
    await flush();
    stdin.write("\r"); // Enter again — no narrow drill; two-pane preserved.
    await flush();
    const frame = stripAnsi(lastFrame());
    // Wide render still has mode-tabs row ("WORKFLOWS", "RUNS", "RUN" text).
    expect(frame).toContain("WORKFLOWS");
    expect(frame).toContain("RUNS");
    unmount();
  });
});
