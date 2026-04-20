// test/components/runs-table-medium.test.tsx
//
// P8-T1 §4.2 acceptance anchor for <RunsTable> at medium tier (width=90).
// Asserts:
//   - header set is exactly {ID, WORKFLOW, STATUS, STEP, AGE, NOTE}
//   - STARTED / ELAPSED are absent
//   - an attempt-fold row surfaces "build 2/3" inside the STEP cell

import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { RunInfo, StepResult } from "markflow-cli";
import { ThemeProvider } from "../../src/theme/context.js";
import { RunsTable } from "../../src/components/runs-table.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import {
  RUNS_ARCHIVE_DEFAULTS,
  type RunsFilterState,
  type RunsSortState,
  type RunsTableRow,
} from "../../src/runs/types.js";

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

function row(overrides: Partial<RunInfo> = {}): RunsTableRow {
  const info: RunInfo = {
    id: overrides.id ?? "abcd1234",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: "./deploy.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
  return toRunsTableRow(info, NOW);
}

const DEFAULT_SORT: RunsSortState = { key: "attention", direction: "desc" };
const DEFAULT_FILTER: RunsFilterState = {
  open: false,
  draft: "",
  applied: { raw: "", terms: [] },
};

// Fixture row whose STEP carries batch progress ("build 2/3") via the
// batch-progress branch of deriveStepLabel. Using `region` as the common
// prefix triggers the "N/M" suffix — the step node name embeds the index.
function buildAttemptFoldRow(): RunsTableRow {
  // deriveStepLabel returns `"<base> <cur>/<total>"` when it detects a
  // batch pattern. extractBatchProgress reads the last step's index and
  // counts trailing siblings: current=count, total=max(lastIndex+1,count).
  // Craft two trailing siblings with last index 2 → "build 2/3".
  const steps: StepResult[] = [
    step({
      node: "build#1",
      completed_at: "2026-04-17T11:55:10Z",
      exit_code: 0,
    }),
    step({
      node: "build#2",
      completed_at: "2026-04-17T11:55:20Z",
      exit_code: 0,
    }),
  ];
  return row({
    id: "abcd1234",
    workflowName: "deploy",
    status: "running",
    steps,
  });
}

function renderAt90(rows: ReadonlyArray<RunsTableRow>) {
  const dispatch = vi.fn();
  const r = render(
    <ThemeProvider>
      <RunsTable
        rows={rows}
        sort={DEFAULT_SORT}
        runsFilter={DEFAULT_FILTER}
        runsArchive={RUNS_ARCHIVE_DEFAULTS}
        selectedRunId={null}
        cursor={0}
        width={90}
        height={12}
        nowMs={NOW}
        dispatch={dispatch}
        inputDisabled
      />
    </ThemeProvider>,
  );
  return {
    frame: () => stripAnsi(r.lastFrame() ?? ""),
    cleanup: () => r.unmount(),
  };
}

describe("<RunsTable> medium tier (width=90)", () => {
  const sample: ReadonlyArray<RunsTableRow> = [
    row({ id: "abcd12", workflowName: "deploy", status: "running" }),
    row({ id: "efgh34", workflowName: "release", status: "suspended" }),
    row({ id: "ijkl56", workflowName: "deploy-stg", status: "complete" }),
    row({ id: "mnop78", workflowName: "backfill", status: "error" }),
    row({ id: "qrst90", workflowName: "publish", status: "running" }),
  ];

  it("header contains ID, WORKFLOW, STATUS, STEP, AGE, NOTE", () => {
    const { frame, cleanup } = renderAt90(sample);
    const f = frame();
    expect(f).toContain("ID");
    expect(f).toContain("WORKFLOW");
    expect(f).toContain("STATUS");
    expect(f).toContain("STEP");
    expect(f).toContain("AGE");
    expect(f).toContain("NOTE");
    cleanup();
  });

  it("does not include STARTED or a bare ELAPSED header at width=90", () => {
    const { frame, cleanup } = renderAt90(sample);
    const f = frame();
    expect(f).not.toContain("STARTED");
    expect(f).not.toMatch(/\bELAPSED\b/);
    cleanup();
  });

  it("attempt fold: a batched build run renders 'build 2/3' in the STEP cell", () => {
    const { frame, cleanup } = renderAt90([buildAttemptFoldRow()]);
    const f = frame();
    // STEP cell contains the folded "build N/M" string.
    expect(f).toContain("build 2/3");
    // No ATTEMPT column header at this tier.
    expect(f).not.toContain("ATTEMPT");
    cleanup();
  });
});
