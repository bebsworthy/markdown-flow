// test/app/run-mode-step-table.test.tsx
//
// Integration tests for P6-T1 — the step table mounts in `viewing.*` RUN
// mode. Drives the full <App> tree via ink-testing-library and asserts:
//   - Entering RUN mode swaps the runs-table for <StepTableView>
//   - Bottom slot retains the <RunDetailPlaceholder>
//   - Esc from RUN mode restores the runs-table
//   - engineState seed drives the step rows (columns headers appear)

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo, StepResult } from "markflow";
import { App } from "../../src/app.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const KEY_RUNS = "2";
const ENTER = "\r";
const ESC = "\x1b";

const NOW = Date.parse("2026-04-17T12:00:00Z");

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
  row({
    id: "abcd1234",
    workflowName: "deploy-prod",
    status: "running",
    startedAt: "2026-04-17T11:55:00Z",
    steps: [step({ node: "build" })],
  }),
];

async function flush(n = 4): Promise<void> {
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
    />,
  );
}

function firstLine(frame: string): string {
  return frame.split("\n")[0] ?? "";
}

describe("App — step table in RUN mode (P6-T1)", () => {
  it("Enter on a run row mounts <StepTableView> in the top slot", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    expect(firstLine(frame)).toContain("[ RUN ]");
    // Step-table column headers present.
    expect(frame).toContain("STEP");
    expect(frame).toContain("STATUS");
    unmount();
  });

  it("Bottom slot renders the step detail panel in RUN mode (P6-T2)", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    // P6-T4: default zoom focus is `graph` (full-pane); switch to `detail`
    // (key `2`) so the detail panel is visible in the bottom slot.
    stdin.write("2");
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    // Detail panel defaults to the first row (view-layer fallback) so the
    // selected node's headline renders in the bottom slot.
    expect(frame).toContain("build");
    expect(frame).toContain("script (bash)");
    unmount();
  });

  it("engineState-less App still renders 'no steps yet' empty state in RUN mode", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();
    // P6-T4: default zoom focus is `graph` (full-pane); switch to `detail`
    // (key `2`) so the step-table empty state renders in the top slot.
    stdin.write("2");
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    expect(firstLine(frame)).toContain("[ RUN ]");
    expect(frame).toContain("no steps yet");
    unmount();
  });

  it("Esc from RUN mode restores the runs-table (StepTable is unmounted)", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();

    // Confirm step table was showing.
    const zoomed = stripAnsi(lastFrame() ?? "");
    expect(zoomed).toContain("STEP");

    stdin.write(ESC);
    await flush();

    const unzoomed = stripAnsi(lastFrame() ?? "");
    expect(firstLine(unzoomed)).toContain("[ RUNS ]");
    // Runs-table back — row id is present.
    expect(unzoomed).toContain("abcd1234");
    // Step-table headers should be gone.
    expect(unzoomed).not.toMatch(/\bSTATUS\b\s+\bATTEMPT\b/);
    unmount();
  });

  it("engineState with build event → 'build' node label rendered in the top pane", async () => {
    const { stdin, lastFrame, unmount } = renderApp({
      engineState: buildEngineState("abcd1234"),
    });
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();

    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("build");
    expect(frame).toContain("running");
    unmount();
  });
});
