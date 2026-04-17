// test/components/step-detail-panel-view.test.tsx
//
// Tests for <StepDetailPanelView> — the engine-slice projection wrapper
// that feeds <StepDetailPanel>.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepDetailPanelView } from "../../src/components/step-detail-panel-view.js";
import { initialEngineState } from "../../src/engine/reducer.js";
import type {
  EngineState,
  LiveRunSnapshot,
} from "../../src/engine/types.js";

const THEME = buildTheme({ color: true, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const NOW = Date.parse("2026-04-17T12:04:25Z");

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "multi-region",
    sourceFile: overrides.sourceFile ?? "./w.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T12:01:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function renderView(args: {
  runId: string;
  selectedStepId: string | null;
  engineState: EngineState;
  width?: number;
  height?: number;
}): string {
  const { lastFrame } = render(
    <ThemeProvider value={THEME}>
      <StepDetailPanelView
        runId={args.runId}
        selectedStepId={args.selectedStepId}
        engineState={args.engineState}
        width={args.width ?? 133}
        height={args.height ?? 12}
        nowMs={NOW}
      />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

describe("<StepDetailPanelView>", () => {
  it("renders empty hint when no run and no selection", () => {
    const frame = renderView({
      runId: "r1",
      selectedStepId: null,
      engineState: initialEngineState,
    });
    expect(frame).toContain("select a step to see details");
  });

  it("renders not-found when selectedStepId is unknown", () => {
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun: null,
    };
    const frame = renderView({
      runId: "r1",
      selectedStepId: "unknown",
      engineState,
    });
    expect(frame).toContain("no longer in run");
  });

  it("falls back to first row when selectedStepId is null and rows exist", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "2026-04-17T12:00:00Z", type: "token:created",
        tokenId: "t-build", nodeId: "build", generation: 0,
      } as EngineEvent,
      {
        seq: 2, ts: "2026-04-17T12:00:01Z", type: "step:start",
        nodeId: "build", tokenId: "t-build",
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
    const frame = renderView({
      runId: "r1",
      selectedStepId: null,
      engineState,
    });
    expect(frame).toContain("build");
  });

  it("renders selected token when selectedStepId matches", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "2026-04-17T12:00:00Z", type: "token:created",
        tokenId: "t-build", nodeId: "build", generation: 0,
      } as EngineEvent,
      {
        seq: 2, ts: "2026-04-17T12:00:00Z", type: "token:created",
        tokenId: "t-deploy", nodeId: "deploy", generation: 0,
      } as EngineEvent,
      {
        seq: 3, ts: "2026-04-17T12:00:01Z", type: "step:start",
        nodeId: "deploy", tokenId: "t-deploy",
      } as EngineEvent,
    ];
    const activeRun: LiveRunSnapshot = {
      runId: "r1",
      info: info(),
      events,
      lastSeq: 3,
      terminal: false,
    };
    const engineState: EngineState = {
      runs: new Map([["r1", info()]]),
      activeRun,
    };
    const frame = renderView({
      runId: "r1",
      selectedStepId: "t-deploy",
      engineState,
    });
    expect(frame).toContain("deploy");
  });

  it("falls back to empty when activeRun belongs to a different run", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "token:created",
        tokenId: "t-x", nodeId: "x", generation: 0,
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
    const frame = renderView({
      runId: "r1",
      selectedStepId: null,
      engineState,
    });
    expect(frame).toContain("select a step to see details");
  });

  it("passes width/height through without crashing", () => {
    const frame = renderView({
      runId: "r1",
      selectedStepId: null,
      engineState: initialEngineState,
      width: 100,
      height: 6,
    });
    expect(frame).toContain("select a step to see details");
  });
});
