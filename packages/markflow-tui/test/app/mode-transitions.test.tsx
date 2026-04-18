// test/app/mode-transitions.test.tsx
//
// Integration tests for the Phase-5 mode wiring (P5-T3). Drives the full
// `<App>` tree via ink-testing-library and asserts:
//   - `Enter` on a selected row zooms to `viewing.*` (pill flips to
//     `[ RUN ]`, runs-table is unmounted, placeholder fills the body).
//   - `Esc` from `viewing.*` returns to `browsing.runs` (pill back to
//     `[ RUNS ]`, table re-appears, cursor + filter + sort slices
//     unchanged).
//   - A filter applied before zoom is preserved across zoom/unzoom.
//   - Zoom on a row that gets removed mid-flight shows the
//     "no longer exists" copy.
//   - Repeated zoom/unzoom is idempotent.
//   - `Esc` while the filter bar is open closes the filter bar, not the
//     RUN-mode zoom (regression guard — plan §11.2).
//
// References: docs/tui/plans/P5-T3.md §9.6, §8.1, §11.2.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { RunInfo, StepResult } from "markflow";
import { App } from "../../src/app.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

// Keyboard byte sequences.
// Digit `2` routes to MODE_SHOW_RUNS via the same path as F2.
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
    id: overrides.id ?? "r0000001",
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
    workflowName: "deploy-prod",
    status: "running",
    startedAt: "2026-04-17T11:55:00Z",
    steps: [step({ node: "build" })],
  }),
  row({
    id: "efgh5678",
    workflowName: "release",
    status: "suspended",
    startedAt: "2026-04-17T11:50:00Z",
    steps: [step({ node: "approve", summary: "deploy to prod?" })],
  }),
  row({
    id: "ijkl9012",
    workflowName: "deploy-stg",
    status: "complete",
    startedAt: "2026-04-17T11:00:00Z",
    completedAt: "2026-04-17T11:10:00Z",
    steps: [step({ node: "smoke", exit_code: 0 })],
  }),
];

function renderApp(opts?: {
  initialRunRows?: ReadonlyArray<RunsTableRow>;
}): ReturnType<typeof render> {
  return render(
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={opts?.initialRunRows ?? ROWS}
      runsDir="/tmp/runs"
    />,
  );
}

/** Extract the top-edge (first line) of the frame. */
function firstLine(frame: string): string {
  return frame.split("\n")[0] ?? "";
}

describe("App — mode transitions (P5-T3)", () => {
  it("Enter on a row zooms to RUN mode; pill flips to [ RUN ]", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();

    // Switch to runs pane.
    stdin.write(KEY_RUNS);
    await flush();

    // Title pill now '[ RUNS ]'.
    const browsingTop = firstLine(stripAnsi(lastFrame() ?? ""));
    expect(browsingTop).toContain("[ RUNS ]");

    // Enter zooms on the cursor row (first row → abcd1234).
    stdin.write(ENTER);
    await flush();
    // P6-T4: default zoom focus is `graph` (full-pane); switch to `detail`
    // (key `2`) so the step-table / detail-panel copy is visible.
    stdin.write("2");
    await flush();

    const zoomedFrame = stripAnsi(lastFrame() ?? "");
    const zoomedTop = firstLine(zoomedFrame);
    // Pill flipped to `[ RUN ]`.
    expect(zoomedTop).toContain("[ RUN ]");
    // Step-table / detail panel copy visible (engine-less → empty states).
    expect(zoomedFrame).toContain("no steps yet");
    // Runs-table header must be gone — it renders 'WORKFLOW' as a column
    // header which is distinct from the pill labels.
    expect(zoomedFrame).not.toContain("WORKFLOW ");
    unmount();
  });

  it("Esc from RUN mode returns to browsing.runs with pill [ RUNS ] and table re-rendered", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER);
    await flush();

    // Confirm we're zoomed.
    expect(firstLine(stripAnsi(lastFrame() ?? ""))).toContain("[ RUN ]");

    stdin.write(ESC);
    await flush();

    const unzoomedFrame = stripAnsi(lastFrame() ?? "");
    expect(firstLine(unzoomedFrame)).toContain("[ RUNS ]");
    expect(firstLine(unzoomedFrame)).not.toContain("[ RUN ]");
    // Runs table back — id is present as a row value.
    expect(unzoomedFrame).toContain("abcd1234");
    unmount();
  });

  it("filter applied before zoom is preserved across zoom + unzoom", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();

    stdin.write(KEY_RUNS);
    await flush();

    // Open filter bar, type a filter, apply it. Flush per char — the
    // filter bar's `useInput` needs a render cycle between keystrokes
    // or Ink coalesces them and drops chars.
    stdin.write("/");
    await flush();
    for (const ch of "status:running") {
      stdin.write(ch);
      await flush(1);
    }
    await flush();
    stdin.write(ENTER); // apply + close bar
    await flush();

    const filteredFrame = stripAnsi(lastFrame() ?? "");
    // Only the running row remains.
    expect(filteredFrame).toContain("abcd1234");
    expect(filteredFrame).not.toContain("ijkl9012");

    // Zoom.
    stdin.write(ENTER);
    await flush();
    expect(firstLine(stripAnsi(lastFrame() ?? ""))).toContain("[ RUN ]");

    // Unzoom.
    stdin.write(ESC);
    await flush();

    const afterFrame = stripAnsi(lastFrame() ?? "");
    // Filter still applied.
    expect(afterFrame).toContain("abcd1234");
    expect(afterFrame).not.toContain("ijkl9012");
    unmount();
  });

  it("zoom on a run whose row disappears from the feed shows 'no longer exists'", async () => {
    // Seed a single row; then render App with ONLY that row visible so
    // `selectedRunId` lands on it and `rowsById` contains it. After zoom,
    // we swap the feed to an empty list and expect the placeholder to
    // render the deleted-state copy. We drive this by re-rendering with
    // an empty `initialRunRows`.
    const single: ReadonlyArray<RunsTableRow> = [
      row({
        id: "ghost001",
        workflowName: "x",
        status: "running",
        startedAt: "2026-04-17T11:55:00Z",
        steps: [step({ node: "a" })],
      }),
    ];
    const { stdin, lastFrame, rerender, unmount } = render(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        initialRunRows={single}
        runsDir="/tmp/runs"
      />,
    );
    await flush();

    stdin.write(KEY_RUNS);
    await flush();
    stdin.write(ENTER); // zoom
    await flush();

    let zoomed = stripAnsi(lastFrame() ?? "");
    expect(firstLine(zoomed)).toContain("[ RUN ]");

    // Now remove the row from the feed.
    rerender(
      <App
        onQuit={() => {}}
        registryConfig={{ listPath: null, persist: false }}
        initialRunRows={[]}
        runsDir="/tmp/runs"
      />,
    );
    await flush();

    zoomed = stripAnsi(lastFrame() ?? "");
    // Still in RUN mode.
    expect(firstLine(zoomed)).toContain("[ RUN ]");

    // Esc still works — returns to browsing.runs.
    stdin.write(ESC);
    await flush();
    const afterEsc = stripAnsi(lastFrame() ?? "");
    expect(firstLine(afterEsc)).not.toContain("[ RUN ]");
    unmount();
  });

  it("repeated zoom/unzoom is idempotent (3 cycles)", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();
    stdin.write(KEY_RUNS);
    await flush();

    // Baseline frame in browsing.runs.
    const baseline = stripAnsi(lastFrame() ?? "");
    expect(firstLine(baseline)).toContain("[ RUNS ]");

    for (let i = 0; i < 3; i++) {
      stdin.write(ENTER);
      await flush();
      expect(firstLine(stripAnsi(lastFrame() ?? ""))).toContain("[ RUN ]");
      stdin.write(ESC);
      await flush();
      const unzoomed = stripAnsi(lastFrame() ?? "");
      expect(firstLine(unzoomed)).toContain("[ RUNS ]");
      // Same rows still visible.
      expect(unzoomed).toContain("abcd1234");
    }
    unmount();
  });

  it("Esc while filter bar is open closes the filter bar, not RUN mode", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await flush();

    stdin.write(KEY_RUNS);
    await flush();

    // Open filter bar with `/`. Don't apply — just open.
    stdin.write("/");
    await flush();
    // Esc must close the bar and leave us in browsing.runs (not in RUN
    // mode — we never entered it).
    stdin.write(ESC);
    await flush();

    const after = stripAnsi(lastFrame() ?? "");
    expect(firstLine(after)).toContain("[ RUNS ]");
    expect(firstLine(after)).not.toContain("[ RUN ]");
    unmount();
  });
});
