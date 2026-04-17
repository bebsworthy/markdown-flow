// test/components/step-table-view.test.tsx
//
// Tests for <StepTableView> — the engine-slice projection wrapper. Exercises:
//  - Empty engine state renders the empty placeholder
//  - Known run with no events renders info.steps-derived rows (if any)
//  - Active run events drive leaf rows
//  - Width / height props forwarded to <StepTable>

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepTableView } from "../../src/components/step-table-view.js";
import { initialEngineState } from "../../src/engine/reducer.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";

const COLOR_UNICODE_THEME = buildTheme({ color: true, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const NOW = Date.parse("2026-04-17T12:00:00Z");

function renderView(props: {
  runId: string;
  engineState: EngineState;
  width?: number;
  height?: number;
  selectedStepId?: string | null;
  cursorRowIndex?: number;
}): string {
  const { lastFrame } = render(
    <ThemeProvider value={COLOR_UNICODE_THEME}>
      <StepTableView
        runId={props.runId}
        engineState={props.engineState}
        width={props.width ?? 140}
        height={props.height ?? 20}
        nowMs={NOW}
        selectedStepId={props.selectedStepId ?? null}
        cursorRowIndex={props.cursorRowIndex}
      />
    </ThemeProvider>,
  );
  return lastFrame() ?? "";
}

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "multi-region",
    sourceFile: overrides.sourceFile ?? "./w.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

describe("<StepTableView>", () => {
  it("renders 'no steps yet' for a completely empty EngineState", () => {
    const frame = stripAnsi(
      renderView({ runId: "r1", engineState: initialEngineState }),
    );
    expect(frame).toContain("no steps yet");
  });

  it("renders 'no steps yet' for a known run with no events and no steps", () => {
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun: null,
    };
    const frame = stripAnsi(
      renderView({ runId: "r1", engineState }),
    );
    expect(frame).toContain("no steps yet");
  });

  it("renders rows from active-run events", () => {
    const events: EngineEvent[] = [
      {
        seq: 1,
        ts: "2026-04-17T11:59:00Z",
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
      {
        seq: 2,
        ts: "2026-04-17T11:59:01Z",
        type: "step:start",
        nodeId: "build",
        tokenId: "t1",
      } as EngineEvent,
    ];
    const activeRun: LiveRunSnapshot = {
      runId: "r1",
      info: info(),
      events,
      lastSeq: 2,
      terminal: false,
    };
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun,
    };
    const frame = stripAnsi(
      renderView({ runId: "r1", engineState }),
    );
    expect(frame).toContain("build");
    expect(frame).toContain("running");
  });

  it("ignores activeRun if it's for a different runId", () => {
    const events: EngineEvent[] = [
      {
        seq: 1,
        ts: "2026-04-17T11:59:00Z",
        type: "token:created",
        tokenId: "tx",
        nodeId: "other",
        generation: 0,
      } as EngineEvent,
    ];
    const activeRun: LiveRunSnapshot = {
      runId: "OTHER",
      info: info({ id: "OTHER" }),
      events,
      lastSeq: 1,
      terminal: false,
    };
    const engineState: EngineState = {
      runs: new Map([
        ["r1", info()],
        ["OTHER", info({ id: "OTHER" })],
      ]),
      activeRun,
    };
    const frame = stripAnsi(
      renderView({ runId: "r1", engineState }),
    );
    // 'other' node label must NOT appear in the r1 view.
    expect(frame).not.toContain("other");
  });

  it("renders the column headers when there are rows", () => {
    const events: EngineEvent[] = [
      {
        seq: 1,
        ts: "2026-04-17T11:59:00Z",
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
    ];
    const activeRun: LiveRunSnapshot = {
      runId: "r1",
      info: info(),
      events,
      lastSeq: 1,
      terminal: false,
    };
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun,
    };
    const frame = stripAnsi(renderView({ runId: "r1", engineState, width: 140 }));
    expect(frame).toContain("STEP");
    expect(frame).toContain("STATUS");
  });

  it("narrow width drops ATTEMPT + ELAPSED columns", () => {
    const events: EngineEvent[] = [
      {
        seq: 1,
        ts: "2026-04-17T11:59:00Z",
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
    ];
    const activeRun: LiveRunSnapshot = {
      runId: "r1",
      info: info(),
      events,
      lastSeq: 1,
      terminal: false,
    };
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun,
    };
    const frame = stripAnsi(renderView({ runId: "r1", engineState, width: 70 }));
    expect(frame).not.toContain("ATTEMPT");
    expect(frame).not.toContain("ELAPSED");
    expect(frame).toContain("STATUS");
  });
});
