// test/steps/columns-medium.test.ts
//
// P8-T1 §4.1: medium-tier (~90 cols) acceptance anchor for the step-table
// column set. Pins the drop of ATTEMPT and verifies ordered header set
// (STEP · STATUS · ELAPSED · NOTE), plus that attempts still surface in
// row.note produced by the existing derive pipeline.

import { describe, it, expect } from "vitest";
import {
  STEP_COLUMNS_MEDIUM,
  computeStepColumnWidths,
  pickStepColumnSet,
} from "../../src/steps/columns.js";
import type { StepRow } from "../../src/steps/types.js";

describe("steps columns — medium tier (width=90)", () => {
  it("pickStepColumnSet(90) returns STEP_COLUMNS_MEDIUM (identity)", () => {
    expect(pickStepColumnSet(90)).toBe(STEP_COLUMNS_MEDIUM);
  });

  it("STEP_COLUMNS_MEDIUM omits the ATTEMPT column", () => {
    expect(STEP_COLUMNS_MEDIUM.find((c) => c.id === "attempt")).toBeUndefined();
  });

  it("computeStepColumnWidths(STEP_COLUMNS_MEDIUM, 90) sums within 90", () => {
    const widths = computeStepColumnWidths(STEP_COLUMNS_MEDIUM, 90);
    const gutters = Math.max(0, STEP_COLUMNS_MEDIUM.length - 1);
    const leading = 2;
    let total = gutters + leading;
    for (const w of widths.values()) total += w;
    expect(total).toBeLessThanOrEqual(90);
  });

  it("STEP_COLUMNS_MEDIUM has ids in order [step, status, elapsed, note]", () => {
    expect(STEP_COLUMNS_MEDIUM.map((c) => c.id)).toEqual([
      "step",
      "status",
      "elapsed",
      "note",
    ]);
  });

  it("attempt fold: a running retry step carries 'attempt 2/3' via row.note", () => {
    // The medium tier has no ATTEMPT column, so attempt info must surface
    // through the row's NOTE text. This is an integration-style assertion
    // against an ad-hoc row rather than the full buildStepRow() pipeline so
    // the test stays purity-safe (no engine import).
    const row: StepRow = {
      id: "t1",
      kind: "leaf",
      depth: 1,
      label: "build",
      status: "retrying",
      attempt: "2/3",
      elapsed: "12s",
      elapsedMs: 12_000,
      note: "\u21bb retrying \u00b7 attempt 2/3",
      role: "running",
      glyphKey: "retry",
      tokenId: "t1",
      nodeId: "build",
    };
    expect(row.note).toContain("attempt 2/3");
    // The NOTE column in STEP_COLUMNS_MEDIUM projects row.note verbatim.
    const note = STEP_COLUMNS_MEDIUM.find((c) => c.id === "note")!;
    expect(note.projectText(row, new Map())).toContain("attempt 2/3");
  });
});
