// test/app/medium-width.test.tsx
//
// P8-T1 §4.3 — app-level integration render at width=90 across three mode
// seeds: browsing.runs, viewing.graph, viewing.log. ink-testing-library
// hard-codes `columns=100`, so we stand up our own Stdout shim that returns
// 90 and drive Ink directly. Assertions deliberately focus on structural
// invariants that survive Ink's reflow noise:
//   - keybar line length ≤ 90 after ANSI-strip
//   - required column headers / tab tokens present
//   - no STARTED column at medium tier
//   - top-frame mode tabs not compressed (regression guard, §5 criterion 7)

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

const KEY_RUNS = "2";
const ENTER = "\r";

const NOW = Date.parse("2026-04-17T12:00:00Z");

// ---------------------------------------------------------------------------
// Synthetic stdio with configurable `columns`.
// ---------------------------------------------------------------------------

class SizedStdout extends EventEmitter {
  public readonly columns: number;
  public frames: string[] = [];
  private _lastFrame: string | undefined;
  constructor(columns: number) {
    super();
    this.columns = columns;
  }
  write = (frame: string): void => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };
  lastFrame = (): string | undefined => this._lastFrame;
}

class TestStdin extends EventEmitter {
  public isTTY = true;
  private data: string | null = null;
  write = (data: string): void => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

function renderAtWidth(
  tree: React.ReactElement,
  width: number,
): {
  readonly lastFrame: () => string;
  readonly stdin: TestStdin;
  readonly unmount: () => void;
} {
  const stdout = new SizedStdout(width);
  const stderr = new SizedStdout(width);
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
    lastFrame: (): string => stdout.lastFrame() ?? "",
    stdin,
    unmount: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function step(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "build",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "success",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T11:55:00Z",
    completed_at: overrides.completed_at ?? "2026-04-17T11:55:30Z",
    exit_code: overrides.exit_code ?? 0,
  };
}

function info(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: overrides.id ?? "abcd1234",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "./deploy.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function row(overrides: Partial<RunInfo>): RunsTableRow {
  return toRunsTableRow(info(overrides), NOW);
}

const ROWS: ReadonlyArray<RunsTableRow> = [
  row({
    id: "abcd1234",
    workflowName: "deploy",
    status: "running",
    steps: [step({ node: "build" })],
  }),
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
function appTree(opts?: {
  engineState?: EngineState;
  initialRunRows?: ReadonlyArray<RunsTableRow>;
}): React.ReactElement {
  return (
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={opts?.initialRunRows ?? ROWS}
      engineState={opts?.engineState}
      runsDir="/tmp/runs"
    />
  );
}

// The keybar line is whichever line contains the help-key ("?") or the
// mode-pill markers. We identify it by scanning for "q" (quit) near the end
// of the frame — present in every mode.
function findKeybarLine(frame: string): string {
  const lines = frame.split("\n");
  // Scan bottom-up for a non-empty line that isn't the box border.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").replace(/\s+$/g, "");
    if (line.length === 0) continue;
    // Skip the box-drawing border.
    if (/^[\u2500-\u257f\s]+$/.test(line)) continue;
    return line;
  }
  return "";
}

describe("App at width=90 — medium tier (P8-T1 §4.3)", () => {
  it("browsing.runs: runs table header has AGE, lacks STARTED, keybar ≤ 90", async () => {
    const { stdin, lastFrame, unmount } = renderAtWidth(appTree(), 90);
    await flush();

    stdin.write(KEY_RUNS);
    await flush();

    const frame = stripAnsi(lastFrame());
    // Column headers per mockup §12.
    expect(frame).toContain("ID");
    expect(frame).toContain("WORKFLOW");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("STEP");
    expect(frame).toContain("AGE");
    expect(frame).toContain("NOTE");
    // STARTED absolute-time column must be dropped at medium.
    expect(frame).not.toContain("STARTED");
    // Keybar line fits within 90 chars.
    const keybarLine = findKeybarLine(frame);
    expect(keybarLine.length).toBeLessThanOrEqual(90);
    // Top-frame mode tabs NOT compressed (regression guard, §5 criterion 7).
    expect(frame).toContain("RUNS");
    unmount();
  });

  it("viewing.graph: step table uses STEP_COLUMNS_MEDIUM, tabs show letter-bracket form", async () => {
    const { stdin, lastFrame, unmount } = renderAtWidth(
      appTree({ engineState: buildEngineState("abcd1234") }),
      90,
    );
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    // Default zoom is "graph"; switch to "detail" to expose tab header +
    // step table both in the bottom slot.
    stdin.write("2");
    await flush();

    const frame = stripAnsi(lastFrame());
    // Step table present.
    expect(frame).toContain("STEP");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("ELAPSED");
    // ATTEMPT folded — no header.
    expect(frame).not.toContain("ATTEMPT");
    // Tab-header letter-bracket form.
    expect(frame).toContain("[G]raph");
    expect(frame).toContain("[D]etail");
    expect(frame).toContain("[L]og");
    expect(frame).toContain("[E]vents");
    // Keybar fits.
    const keybarLine = findKeybarLine(frame);
    expect(keybarLine.length).toBeLessThanOrEqual(90);
    unmount();
  });

  it("viewing.log: log pane with [L]og tab header, keybar within budget", async () => {
    const { stdin, lastFrame, unmount } = renderAtWidth(
      appTree({ engineState: buildEngineState("abcd1234") }),
      90,
    );
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    // Switch focus to the log pane (key "3" per viewing focus hotkeys).
    stdin.write("3");
    await flush();

    const frame = stripAnsi(lastFrame());
    // Tab-header letter-bracket form — [L]og must be present.
    expect(frame).toContain("[L]og");
    // Keybar fits.
    const keybarLine = findKeybarLine(frame);
    expect(keybarLine.length).toBeLessThanOrEqual(90);
    unmount();
  });
});
