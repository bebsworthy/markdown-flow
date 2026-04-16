// test/runs/columns.test.ts
//
// Unit tests for the pure column table + width picker (P5-T1).

import { describe, it, expect } from "vitest";
import type { RunInfo } from "markflow";
import {
  COLUMNS_140,
  COLUMNS_100,
  COLUMNS_80,
  pickColumnSet,
  computeColumnWidths,
  fitCell,
  WIDE_TIER_MIN,
  MEDIUM_TIER_MIN,
} from "../../src/runs/columns.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");

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

describe("COLUMNS_140", () => {
  it("has the 7 expected column ids in the expected order", () => {
    const ids = COLUMNS_140.map((c) => c.id);
    expect(ids).toEqual([
      "id",
      "workflow",
      "status",
      "step",
      "elapsed",
      "started",
      "note",
    ]);
  });

  it("exactly one column has grow: true (the 'note' column)", () => {
    const growCols = COLUMNS_140.filter((c) => c.grow === true);
    expect(growCols).toHaveLength(1);
    expect(growCols[0]!.id).toBe("note");
  });

  it("fixed-width columns sum to the expected total", () => {
    // 8 + 14 + 12 + 14 + 10 + 10 = 68 (adjusted from the plan's §5.1 draft
    // once `started` dropped to 10 cols — an HH:MM:SS column doesn't need 18).
    const fixed = COLUMNS_140.filter((c) => !c.grow).reduce(
      (sum, c) => sum + c.width,
      0,
    );
    expect(fixed).toBe(8 + 14 + 12 + 14 + 10 + 10);
  });
});

describe("pickColumnSet", () => {
  it(`width >= ${WIDE_TIER_MIN} → COLUMNS_140`, () => {
    expect(pickColumnSet(WIDE_TIER_MIN)).toBe(COLUMNS_140);
    expect(pickColumnSet(140)).toBe(COLUMNS_140);
  });

  it(`width in [${MEDIUM_TIER_MIN}, ${WIDE_TIER_MIN}) → COLUMNS_100 drops STARTED, renames ELAPSED→AGE`, () => {
    const set = pickColumnSet(MEDIUM_TIER_MIN);
    expect(set).toBe(COLUMNS_100);
    const ids = set.map((c) => c.id);
    expect(ids).not.toContain("started");
    const elapsed = set.find((c) => c.id === "elapsed");
    expect(elapsed?.header).toBe("AGE");
  });

  it(`width < ${MEDIUM_TIER_MIN} → COLUMNS_80 drops ELAPSED too`, () => {
    const set = pickColumnSet(MEDIUM_TIER_MIN - 1);
    expect(set).toBe(COLUMNS_80);
    const ids = set.map((c) => c.id);
    expect(ids).not.toContain("started");
    expect(ids).not.toContain("elapsed");
    expect(ids).toEqual(["id", "workflow", "status", "step", "note"]);
  });
});

describe("column projections", () => {
  const r = row({
    id: "abcd1234xyz",
    workflowName: "deploy",
    status: "running",
    startedAt: "2026-04-17T11:55:00Z",
  });

  it("id column projects the short id", () => {
    const col = COLUMNS_140.find((c) => c.id === "id")!;
    expect(col.projectText(r)).toBe("abcd12");
  });

  it("workflow column fits into width (truncation uses ellipsis if needed)", () => {
    const col = COLUMNS_140.find((c) => c.id === "workflow")!;
    const long = row({ workflowName: "a-very-long-workflow-name" });
    const text = fitCell(col.projectText(long), col.width, col.align);
    expect(text).toHaveLength(col.width);
    expect(text).toMatch(/…/);
  });

  it("status column returns StatusCell with glyph + role + label", () => {
    const col = COLUMNS_140.find((c) => c.id === "status")!;
    expect(col.projectStatus).toBeDefined();
    const cell = col.projectStatus!(r);
    expect(cell.label).toBe("running");
    expect(cell.role).toBe("running");
    expect(cell.glyphKey).toBe("running");
  });

  it("note column grows to fill the remaining width", () => {
    const widths = computeColumnWidths(COLUMNS_140, 140);
    const noteIdx = COLUMNS_140.findIndex((c) => c.id === "note");
    // 140 - fixed (68) - 6 gutters - 2 leading = 64 → grow budget.
    expect(widths[noteIdx]).toBeGreaterThan(20);
  });
});
