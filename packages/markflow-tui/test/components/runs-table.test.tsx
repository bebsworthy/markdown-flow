// test/components/runs-table.test.tsx
//
// Snapshot-ish tests for the <RunsTable> component. Uses ink-testing-library;
// the `width` prop drives column-set selection instead of
// `useStdout().stdout.columns`.

import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { RunInfo, StepResult } from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { RunsTable } from "../../src/components/runs-table.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsSortState, RunsTableRow } from "../../src/runs/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

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
    id: "r0000001",
    workflowName: "deploy-prod",
    status: "running",
    startedAt: "2026-04-17T11:55:00Z",
    steps: [step({ node: "build" })],
  }),
  row({
    id: "r0000002",
    workflowName: "release",
    status: "suspended",
    startedAt: "2026-04-17T11:50:00Z",
    steps: [step({ node: "approve", summary: "deploy to prod?" })],
  }),
  row({
    id: "r0000003",
    workflowName: "deploy-stg",
    status: "complete",
    startedAt: "2026-04-17T11:00:00Z",
    completedAt: "2026-04-17T11:10:00Z",
    steps: [step({ node: "smoke", exit_code: 0 })],
  }),
  row({
    id: "r0000004",
    workflowName: "backfill",
    status: "error",
    startedAt: "2026-04-17T10:00:00Z",
    completedAt: "2026-04-17T10:05:00Z",
    steps: [step({ node: "index", summary: "DB down", exit_code: 1 })],
  }),
];

const DEFAULT_SORT: RunsSortState = { key: "attention", direction: "desc" };

function renderTable(props: {
  rows?: ReadonlyArray<RunsTableRow>;
  sort?: RunsSortState;
  selectedRunId?: string | null;
  width?: number;
  height?: number;
  dispatch?: ReturnType<typeof vi.fn>;
  inputDisabled?: boolean;
}) {
  const dispatch = props.dispatch ?? vi.fn();
  const rendered = render(
    <ThemeProvider>
      <RunsTable
        rows={props.rows ?? ROWS}
        sort={props.sort ?? DEFAULT_SORT}
        selectedRunId={props.selectedRunId ?? null}
        width={props.width ?? 140}
        height={props.height ?? 12}
        dispatch={dispatch}
        inputDisabled={props.inputDisabled}
      />
    </ThemeProvider>,
  );
  return {
    frame: () => stripAnsi(rendered.lastFrame() ?? ""),
    stdin: rendered.stdin,
    dispatch,
    cleanup: () => rendered.unmount(),
  };
}

// ---------------------------------------------------------------------------
// Widths / column sets
// ---------------------------------------------------------------------------

describe("<RunsTable> — wide tier (140 cols)", () => {
  it("renders the full 7-column header row", () => {
    const { frame, cleanup } = renderTable({ width: 140, inputDisabled: true });
    const f = frame();
    expect(f).toContain("ID");
    expect(f).toContain("WORKFLOW");
    expect(f).toContain("STATUS");
    expect(f).toContain("STEP");
    expect(f).toContain("ELAPSED");
    expect(f).toContain("STARTED");
    expect(f).toContain("NOTE");
    cleanup();
  });

  it("renders one line per row plus the header", () => {
    const { frame, cleanup } = renderTable({ width: 140, inputDisabled: true });
    const lines = frame().split("\n").filter((l) => l.trim().length > 0);
    // header + 4 rows = 5 non-empty lines (ink may pad with trailing spaces).
    expect(lines.length).toBeGreaterThanOrEqual(5);
    cleanup();
  });

  it("includes workflow names", () => {
    const { frame, cleanup } = renderTable({ width: 140, inputDisabled: true });
    const f = frame();
    expect(f).toContain("deploy-prod");
    expect(f).toContain("release");
    expect(f).toContain("deploy-stg");
    expect(f).toContain("backfill");
    cleanup();
  });
});

describe("<RunsTable> — medium tier (~100 cols)", () => {
  it("drops STARTED and folds ELAPSED → AGE", () => {
    const { frame, cleanup } = renderTable({ width: 100, inputDisabled: true });
    const f = frame();
    expect(f).not.toContain("STARTED");
    expect(f).toContain("AGE");
    expect(f).not.toMatch(/\bELAPSED\b/);
    cleanup();
  });
});

describe("<RunsTable> — narrow tier (<90 cols)", () => {
  it("drops both ELAPSED/AGE and STARTED", () => {
    const { frame, cleanup } = renderTable({ width: 80, inputDisabled: true });
    const f = frame();
    expect(f).not.toMatch(/\bELAPSED\b/);
    expect(f).not.toMatch(/\bAGE\b/);
    expect(f).not.toContain("STARTED");
    // Kept columns:
    expect(f).toContain("ID");
    expect(f).toContain("WORKFLOW");
    expect(f).toContain("STATUS");
    expect(f).toContain("STEP");
    expect(f).toContain("NOTE");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

describe("<RunsTable> — sort ordering", () => {
  it("attention: active rows appear before terminal rows in the frame", () => {
    const { frame, cleanup } = renderTable({
      width: 140,
      sort: { key: "attention", direction: "desc" },
      inputDisabled: true,
    });
    const f = frame();
    const activeIdx = Math.min(
      f.indexOf("deploy-prod"),
      f.indexOf("release"),
    );
    const terminalIdx = Math.min(
      f.indexOf("deploy-stg"),
      f.indexOf("backfill"),
    );
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(terminalIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeLessThan(terminalIdx);
    cleanup();
  });

  it("workflow sort: case-fold alphabetical (backfill first)", () => {
    const { frame, cleanup } = renderTable({
      width: 140,
      sort: { key: "workflow", direction: "desc" },
      inputDisabled: true,
    });
    const f = frame();
    // desc direction is flipped by sort.ts — key compares already desc-oriented
    // for timestamps, but 'workflow' is a lexical compare that returns asc; so
    // the *visible* order here is asc unchanged (the flip multiplies by 1).
    const backfillIdx = f.indexOf("backfill");
    const releaseIdx = f.indexOf("release");
    expect(backfillIdx).toBeLessThan(releaseIdx);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Cursor + selection
// ---------------------------------------------------------------------------

describe("<RunsTable> — cursor", () => {
  it("renders the ▶ glyph on the selected row only", () => {
    const { frame, cleanup } = renderTable({
      width: 140,
      selectedRunId: "r0000001",
      inputDisabled: true,
    });
    const f = frame();
    // Exactly one row should carry the cursor glyph.
    const matches = f.match(/▶/g) ?? [];
    expect(matches.length).toBe(1);
    cleanup();
  });

  it("no cursor glyph when selectedRunId is null", () => {
    const { frame, cleanup } = renderTable({
      width: 140,
      selectedRunId: null,
      inputDisabled: true,
    });
    expect(frame()).not.toContain("▶");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// `s` dispatch
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("<RunsTable> — key handling", () => {
  it("dispatches RUNS_SORT_CYCLE on 's'", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({ width: 140, dispatch });
    await flush();
    stdin.write("s");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_SORT_CYCLE" });
    cleanup();
  });

  it("does NOT dispatch on 's' when inputDisabled is true", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({
      width: 140,
      dispatch,
      inputDisabled: true,
    });
    await flush();
    stdin.write("s");
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
  });

  it("ignores unrelated keys", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({ width: 140, dispatch });
    await flush();
    stdin.write("x");
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("<RunsTable> — empty state", () => {
  it("renders 'no runs yet' with no header chrome", () => {
    const { frame, cleanup } = renderTable({
      rows: [],
      width: 140,
      inputDisabled: true,
    });
    const f = frame();
    expect(f).toContain("no runs yet");
    expect(f).not.toContain("WORKFLOW");
    expect(f).not.toContain("STATUS");
    cleanup();
  });
});
