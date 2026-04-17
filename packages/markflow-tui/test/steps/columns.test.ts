// test/steps/columns.test.ts
//
// Unit tests for `src/steps/columns.ts` — step-table column sets, width
// computation, cell fitter. Column-set picks should match mockups §4 (wide),
// plan §5.2 (medium), §5.3 (narrow) tiers.

import { describe, it, expect } from "vitest";
import {
  STEP_COLUMNS_NARROW,
  STEP_COLUMNS_MEDIUM,
  STEP_COLUMNS_WIDE,
  STEP_WIDE_TIER_MIN,
  STEP_MEDIUM_TIER_MIN,
  computeStepColumnWidths,
  fitStepCell,
  pickStepColumnSet,
} from "../../src/steps/columns.js";
import type { StepRow, StepTableColumn } from "../../src/steps/types.js";

describe("pickStepColumnSet", () => {
  it("width >= 120 → WIDE set", () => {
    expect(pickStepColumnSet(STEP_WIDE_TIER_MIN)).toBe(STEP_COLUMNS_WIDE);
    expect(pickStepColumnSet(200)).toBe(STEP_COLUMNS_WIDE);
  });

  it("90 <= width < 120 → MEDIUM set (drops ATTEMPT)", () => {
    expect(pickStepColumnSet(STEP_MEDIUM_TIER_MIN)).toBe(STEP_COLUMNS_MEDIUM);
    expect(pickStepColumnSet(100)).toBe(STEP_COLUMNS_MEDIUM);
    expect(pickStepColumnSet(119)).toBe(STEP_COLUMNS_MEDIUM);
    expect(STEP_COLUMNS_MEDIUM.some((c) => c.id === "attempt")).toBe(false);
  });

  it("width < 90 → NARROW set (drops ATTEMPT and ELAPSED)", () => {
    expect(pickStepColumnSet(80)).toBe(STEP_COLUMNS_NARROW);
    expect(pickStepColumnSet(40)).toBe(STEP_COLUMNS_NARROW);
    expect(STEP_COLUMNS_NARROW.some((c) => c.id === "attempt")).toBe(false);
    expect(STEP_COLUMNS_NARROW.some((c) => c.id === "elapsed")).toBe(false);
  });

  it("every set has exactly one grow column (NOTE)", () => {
    for (const set of [STEP_COLUMNS_WIDE, STEP_COLUMNS_MEDIUM, STEP_COLUMNS_NARROW]) {
      const growing = set.filter((c) => c.grow);
      expect(growing).toHaveLength(1);
      expect(growing[0]!.id).toBe("note");
    }
  });

  it("WIDE fixed column widths sum to 62 (STEP28 + STATUS14 + ATTEMPT10 + ELAPSED10 + NOTE0)", () => {
    const fixedSum = STEP_COLUMNS_WIDE
      .filter((c) => !c.grow)
      .reduce((s, c) => s + c.width, 0);
    expect(fixedSum).toBe(28 + 14 + 10 + 10);
  });
});

describe("computeStepColumnWidths", () => {
  it("empty columns → empty map", () => {
    expect(computeStepColumnWidths([], 100).size).toBe(0);
  });

  it("WIDE @ 120 cols → NOTE grows to leftover after fixed + gutters + leading", () => {
    const widths = computeStepColumnWidths(STEP_COLUMNS_WIDE, 120);
    expect(widths.get("step")).toBe(28);
    expect(widths.get("status")).toBe(14);
    expect(widths.get("attempt")).toBe(10);
    expect(widths.get("elapsed")).toBe(10);
    // paneWidth 120 - fixed 62 - gutters 4 (between 5 cols) - leading 2 = 52
    expect(widths.get("note")).toBe(52);
  });

  it("NARROW @ 80 cols → NOTE budget = 80 - (28+14) - 2 gutters - 2 leading = 34", () => {
    const widths = computeStepColumnWidths(STEP_COLUMNS_NARROW, 80);
    expect(widths.get("note")).toBe(34);
  });

  it("degenerate tiny pane → NOTE floors at 4", () => {
    const widths = computeStepColumnWidths(STEP_COLUMNS_WIDE, 10);
    expect(widths.get("note")).toBe(4);
  });
});

describe("fitStepCell", () => {
  it("width <= 0 → empty string", () => {
    expect(fitStepCell("hello", 0)).toBe("");
    expect(fitStepCell("hello", -5)).toBe("");
  });

  it("exact length → unchanged", () => {
    expect(fitStepCell("abc", 3)).toBe("abc");
  });

  it("underflow left-align → pads on the right", () => {
    expect(fitStepCell("ab", 5, "left")).toBe("ab   ");
  });

  it("underflow right-align → pads on the left", () => {
    expect(fitStepCell("ab", 5, "right")).toBe("   ab");
  });

  it("overflow → truncates with single ellipsis char", () => {
    expect(fitStepCell("abcdefg", 5)).toBe("abcd\u2026");
  });

  it("overflow width=1 → just the ellipsis", () => {
    expect(fitStepCell("abcdefg", 1)).toBe("\u2026");
  });
});

describe("column text projections", () => {
  const leafRow: StepRow = {
    id: "t1",
    kind: "leaf",
    depth: 2,
    label: "deploy",
    status: "running",
    attempt: "1/3",
    elapsed: "14s",
    elapsedMs: 14_000,
    note: "",
    role: "running",
    glyphKey: "running",
    tokenId: "t1",
    nodeId: "deploy",
  };

  function findCol(
    set: ReadonlyArray<StepTableColumn>,
    id: string,
  ): StepTableColumn {
    const col = set.find((c) => c.id === id);
    if (!col) throw new Error(`no ${id} col`);
    return col;
  }

  it("STEP column prepends 2-space-per-depth indent", () => {
    const step = findCol(STEP_COLUMNS_WIDE, "step");
    expect(step.projectText(leafRow, new Map())).toBe("    deploy");
  });

  it("NOTE column returns row.note verbatim", () => {
    const note = findCol(STEP_COLUMNS_WIDE, "note");
    const withNote: StepRow = { ...leafRow, note: "\u2192 next" };
    expect(note.projectText(withNote, new Map())).toBe("\u2192 next");
  });

  it("ATTEMPT and ELAPSED surface the row fields directly", () => {
    const attempt = findCol(STEP_COLUMNS_WIDE, "attempt");
    const elapsed = findCol(STEP_COLUMNS_WIDE, "elapsed");
    expect(attempt.projectText(leafRow, new Map())).toBe("1/3");
    expect(elapsed.projectText(leafRow, new Map())).toBe("14s");
  });
});
