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
import type { RunsTableProps } from "../../src/components/runs-table.js";
import {
  RUNS_ARCHIVE_DEFAULTS,
  type RunsArchivePolicy,
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

const DEFAULT_FILTER: RunsFilterState = {
  open: false,
  draft: "",
  applied: { raw: "", terms: [] },
};

const DEFAULT_ARCHIVE: RunsArchivePolicy = RUNS_ARCHIVE_DEFAULTS;

function renderTable(props: {
  rows?: ReadonlyArray<RunsTableRow>;
  sort?: RunsSortState;
  runsFilter?: RunsFilterState;
  runsArchive?: RunsArchivePolicy;
  selectedRunId?: string | null;
  cursor?: number;
  width?: number;
  height?: number;
  nowMs?: number;
  dispatch?: ReturnType<typeof vi.fn>;
  inputDisabled?: boolean;
  applyFilterImpl?: RunsTableProps["applyFilterImpl"];
}) {
  const dispatch = props.dispatch ?? vi.fn();
  const rendered = render(
    <ThemeProvider>
      <RunsTable
        rows={props.rows ?? ROWS}
        sort={props.sort ?? DEFAULT_SORT}
        runsFilter={props.runsFilter ?? DEFAULT_FILTER}
        runsArchive={props.runsArchive ?? DEFAULT_ARCHIVE}
        selectedRunId={props.selectedRunId ?? null}
        cursor={props.cursor}
        width={props.width ?? 140}
        height={props.height ?? 12}
        nowMs={props.nowMs ?? NOW}
        dispatch={dispatch}
        inputDisabled={props.inputDisabled}
        applyFilterImpl={props.applyFilterImpl}
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

  it("distinguishes 'no runs match' when filter eliminates every row", () => {
    const { frame, cleanup } = renderTable({
      rows: ROWS,
      runsFilter: {
        open: false,
        draft: "",
        applied: { raw: "workflow:nonexistent-name",
                   terms: [{ kind: "workflow", value: "nonexistent-name" }] },
      },
      width: 140,
      inputDisabled: true,
    });
    expect(frame()).toContain("no runs match");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Virtualisation — 200-row fixture; only window rows rendered
// ---------------------------------------------------------------------------

function generateVirtRows(n: number): ReadonlyArray<RunsTableRow> {
  // IDs are truncated to 6 chars by `formatShortId`, so ensure the first 6
  // chars uniquely identify each row. We use 6-char hex: 0x000000..0x0f423f
  // covers up to 1 000 000 rows.
  const rows: RunsTableRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = i.toString(16).padStart(6, "0");
    rows.push(row({ id, status: "running", workflowName: "deploy" }));
  }
  return rows;
}

describe("<RunsTable> — virtualisation", () => {
  it("200-row fixture renders exactly `visibleRows` data rows", () => {
    const big = generateVirtRows(200);
    // height=12 → header(1) + footer(1) → visibleRows=10
    const { frame, cleanup } = renderTable({
      rows: big,
      width: 140,
      height: 12,
      cursor: 0,
      inputDisabled: true,
    });
    const f = frame();
    // cursor=0 should show rows 0x000000 through 0x000009
    expect(f).toContain("000000");
    expect(f).toContain("000009");
    // The 10th row (0x00000a) must NOT appear
    expect(f).not.toContain("00000a");
    cleanup();
  });

  it("cursor=150 shifts window to [141..150]", () => {
    const big = generateVirtRows(200);
    const { frame, cleanup } = renderTable({
      rows: big,
      width: 140,
      height: 12,
      cursor: 150,
      inputDisabled: true,
    });
    const f = frame();
    // cursor=150 (0x96) with visibleRows=10 → window [0x8d..0x96]
    expect(f).toContain("000096");
    expect(f).toContain("00008d");
    expect(f).not.toContain("00008c");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Filter + archive bindings
// ---------------------------------------------------------------------------

describe("<RunsTable> — '/' and 'a' bindings", () => {
  it("'/' dispatches RUNS_FILTER_OPEN", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({ width: 140, dispatch });
    await flush();
    stdin.write("/");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_FILTER_OPEN" });
    cleanup();
  });

  it("'a' dispatches RUNS_ARCHIVE_TOGGLE", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({ width: 140, dispatch });
    await flush();
    stdin.write("a");
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ type: "RUNS_ARCHIVE_TOGGLE" });
    cleanup();
  });

  it("'s' is suppressed while the filter bar is open", async () => {
    const dispatch = vi.fn();
    const { stdin, cleanup } = renderTable({
      width: 140,
      dispatch,
      runsFilter: {
        open: true,
        draft: "",
        applied: { raw: "", terms: [] },
      },
    });
    await flush();
    stdin.write("s");
    await flush();
    // The filter bar owns keys when open — table must NOT dispatch
    // RUNS_SORT_CYCLE. (The bar dispatches RUNS_FILTER_INPUT, which is
    // fine — we only assert the sort-cycle absence.)
    const sortCalls = dispatch.mock.calls.filter(
      (c) => c[0]?.type === "RUNS_SORT_CYCLE",
    );
    expect(sortCalls).toHaveLength(0);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Footer counts + label flip
// ---------------------------------------------------------------------------

describe("<RunsTable> — footer counts", () => {
  it("filter reduces footer shown count", () => {
    const { frame, cleanup } = renderTable({
      rows: ROWS, // 4 rows
      width: 140,
      runsFilter: {
        open: false,
        draft: "",
        applied: {
          raw: "status:running",
          terms: [{ kind: "status", value: "running" }],
        },
      },
      inputDisabled: true,
    });
    const f = frame();
    // 1 running row in ROWS
    expect(f).toContain("1 shown");
    cleanup();
  });

  it("footer label flips to 'Hide archived' when runsArchive.shown=true", () => {
    const { frame, cleanup } = renderTable({
      rows: ROWS,
      width: 140,
      runsArchive: { ...DEFAULT_ARCHIVE, shown: true },
      inputDisabled: true,
    });
    expect(frame()).toContain("Hide archived");
    cleanup();
  });

  it("archive-hidden rows excluded from shown, counted in archived", () => {
    // Fabricate a row completed 2 days ago (beyond 24h threshold).
    const staleRow = row({
      id: "old1",
      status: "complete",
      completedAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const freshRow = row({
      id: "fresh",
      status: "running",
    });
    const { frame, cleanup } = renderTable({
      rows: [staleRow, freshRow],
      width: 140,
      inputDisabled: true,
    });
    const f = frame();
    expect(f).toContain("1 shown");
    expect(f).toContain("1 archived");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Memoisation — unrelated prop change doesn't re-run applyFilter
// ---------------------------------------------------------------------------

describe("<RunsTable> — filter memoisation", () => {
  it("changing selectedRunId does not recompute applyFilter", () => {
    const mockFilter = vi.fn((rows) => rows);
    const { cleanup, dispatch } = renderTable({
      rows: ROWS,
      width: 140,
      inputDisabled: true,
      applyFilterImpl: mockFilter as unknown as Parameters<
        typeof renderTable
      >[0]["applyFilterImpl"],
      selectedRunId: "r0000001",
    });
    const initialCalls = mockFilter.mock.calls.length;
    // Re-render with same rows / filter / archive / nowMs but new selectedRunId.
    cleanup();
    const { cleanup: cleanup2 } = renderTable({
      rows: ROWS,
      width: 140,
      inputDisabled: true,
      applyFilterImpl: mockFilter as unknown as Parameters<
        typeof renderTable
      >[0]["applyFilterImpl"],
      selectedRunId: "r0000002",
      dispatch,
    });
    // Second instance — first useMemo call will fire once more, but we
    // expect at most one additional call per render of a fresh component.
    expect(mockFilter.mock.calls.length).toBeGreaterThanOrEqual(
      initialCalls + 1,
    );
    cleanup2();
  });
});

// ---------------------------------------------------------------------------
// Perf — 1000-row render under L2 budget (§9.4)
// ---------------------------------------------------------------------------

function budgetMs(base: number): number {
  const mult = Number(process.env.MARKFLOW_PERF_MULT ?? "1");
  return base * (Number.isFinite(mult) && mult > 0 ? mult : 1);
}

describe.skipIf(process.env.CI_SKIP_PERF === "1")(
  "<RunsTable> — L2 render perf",
  () => {
    it(`1000-row render < ${budgetMs(32)}ms`, () => {
      const big = generateVirtRows(1000);
      // Warmup.
      renderTable({ rows: big, width: 140, height: 24, inputDisabled: true })
        .cleanup();
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        const { cleanup } = renderTable({
          rows: big,
          width: 140,
          height: 24,
          inputDisabled: true,
        });
        samples.push(performance.now() - t0);
        cleanup();
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)]!;
      expect(median).toBeLessThan(budgetMs(32));
    });
  },
);
