// test/app/run-mode-log-panel.test.tsx
//
// Integration tests for P6-T3 — the log panel replaces the detail panel in
// RUN-mode bottom slot when focus === "log".

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { App } from "../../src/app.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import type {
  EngineState,
  LiveRunSnapshot,
} from "../../src/engine/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const KEY_RUNS = "2";
const KEY_LOG = "2"; // `2` in viewing mode → log focus
const KEY_DETAIL = "d";
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

async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

function buildEngineState(runId: string): EngineState {
  const events: EngineEvent[] = [
    {
      seq: 1,
      ts: "2026-04-17T11:55:10Z",
      type: "token:created",
      tokenId: "t-build",
      nodeId: "build",
      generation: 0,
    } as EngineEvent,
    {
      seq: 2,
      ts: "2026-04-17T11:55:11Z",
      type: "step:start",
      nodeId: "build",
      tokenId: "t-build",
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

describe("App — RUN-mode log panel (P6-T3)", () => {
  it("pressing `2` in viewing mode swaps bottom slot to the log pane", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        initialRunRows={ROWS}
        engineState={buildEngineState("abcd1234")}
      />,
    );
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    // Detail panel renders by default
    let frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("script (bash)");

    stdin.write(KEY_LOG);
    await flush();
    frame = stripAnsi(lastFrame() ?? "");
    // Log panel either shows the header or "pending" empty state — runsDir
    // is unset so sidecar reads are skipped; the ring hasn't got step:output
    // events for our token, so the panel lands in the empty/pending path.
    expect(frame).toMatch(/Log|log not yet available|select a step/);
    expect(frame).not.toContain("script (bash)");
    unmount();
  });

  it("Esc from log focus returns to graph focus (not close)", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        initialRunRows={ROWS}
        engineState={buildEngineState("abcd1234")}
      />,
    );
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(KEY_LOG);
    await flush();
    stdin.write(ESC);
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    // Detail panel returns (via graph focus → detail panel fallback: the
    // viewing.* branch renders the detail panel when focus !== "log").
    expect(frame).toContain("script (bash)");
    unmount();
  });

  it("pressing `d` returns to detail focus", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        initialRunRows={ROWS}
        engineState={buildEngineState("abcd1234")}
      />,
    );
    await flush();
    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(KEY_LOG);
    await flush();
    stdin.write(KEY_DETAIL);
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("script (bash)");
    unmount();
  });
});
