// test/app/run-mode-detail-panel.test.tsx
//
// Integration tests for P6-T2 — the detail panel replaces the placeholder
// in RUN-mode bottom slot while `browsing.runs` keeps the follow placeholder.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow-cli";
import { App } from "../../src/app.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const KEY_RUNS = "2";
const KEY_DETAIL = "2"; // P6-T4: `2` in viewing mode → detail focus
const ENTER = "\r";
const ESC = "\x1b";
const NOW = Date.parse("2026-04-17T12:00:00Z");

function info(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: overrides.id ?? "abcd1234",
    workflowName: overrides.workflowName ?? "deploy-prod",
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
  row({ id: "abcd1234", workflowName: "deploy-prod", status: "running" }),
];
function buildEngineState(runId: string): EngineState {
  const events: EngineEvent[] = [
    {
      seq: 1, ts: "2026-04-17T11:55:10Z", type: "token:created",
      tokenId: "t-build", nodeId: "build", generation: 0,
    } as EngineEvent,
    {
      seq: 2, ts: "2026-04-17T11:55:11Z", type: "step:start",
      nodeId: "build", tokenId: "t-build",
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

function renderApp(opts?: {
  engineState?: EngineState;
  initialRunRows?: ReadonlyArray<RunsTableRow>;
}): ReturnType<typeof render> {
  return render(
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={opts?.initialRunRows ?? ROWS}
      engineState={opts?.engineState}
      runsDir="/tmp/runs"
    />,
  );
}

describe("App — RUN-mode detail panel (P6-T2)", () => {
  it("zoom bottom slot shows the detail panel (first-row fallback)", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(KEY_DETAIL);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    // Detail panel headline for the first row (`build` node).
    expect(frame).toContain("build");
    expect(frame).toContain("script (bash)");
    // The zoom placeholder string must NOT be present.
    expect(frame).not.toContain("detail pane (Phase 6)");
    unmount();
  });

  it("Esc back to browsing.runs restores the run preview", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(ESC);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    // RunPreview shows the selected run's info fields.
    expect(frame).toContain("Workflow");
    expect(frame).toContain("deploy");
    unmount();
  });

  it("engineState-less RUN mode shows the detail panel empty hint", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(KEY_DETAIL);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    // Without rows/tokens the panel renders its empty-state copy.
    // First char may be clipped by the frame border at narrow widths.
    expect(frame).toMatch(/s?elect a step to see details/);
    unmount();
  });

  it("detail panel defaults follow first step row after engine updates", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(KEY_DETAIL);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    // The node id appears in both the top (step table) and bottom (detail
    // panel headline) slots — both should render.
    const count = (frame.match(/build/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
    unmount();
  });
});
