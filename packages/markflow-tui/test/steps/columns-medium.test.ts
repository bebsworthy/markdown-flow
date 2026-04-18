// test/steps/columns-medium.test.ts
//
// P8-T1 §4.1: medium-tier (~90 cols) acceptance anchor for the step-table
// column set. Pins the drop of ATTEMPT and verifies ordered header set
// (STEP · STATUS · ELAPSED · NOTE), plus that attempts still surface in
// row.note produced by the existing derive pipeline.

import { describe, it, expect } from "vitest";
import {
  STEP_COLUMNS_MEDIUM,
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

  it("STEP_COLUMNS_MEDIUM has exactly one grow column (NOTE)", () => {
    const growing = STEP_COLUMNS_MEDIUM.filter((c) => c.grow);
    expect(growing).toHaveLength(1);
    expect(growing[0]!.id).toBe("note");
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
    const note = STEP_COLUMNS_MEDIUM.find((c) => c.id === "note")!;
    expect(note.projectText(row, new Map())).toContain("attempt 2/3");
  });
});
