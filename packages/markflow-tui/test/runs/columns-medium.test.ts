// test/runs/columns-medium.test.ts
//
// P8-T1 §4.1: medium-tier (~90 cols) acceptance anchor for the runs-table
// column set. These tests pin the drop order (STARTED dropped, ELAPSED
// renamed to AGE) and assert repeat-call identity stability.

import { describe, it, expect } from "vitest";
import {
  COLUMNS_100,
  COLUMNS_80,
  COLUMNS_140,
  pickColumnSet,
} from "../../src/runs/columns.js";

describe("runs columns — medium tier (width=90)", () => {
  it("pickColumnSet(90) returns COLUMNS_100 (identity)", () => {
    expect(pickColumnSet(90)).toBe(COLUMNS_100);
    expect(pickColumnSet(90)).toBe(pickColumnSet(90));
    expect(pickColumnSet(90)).toBe(pickColumnSet(90));
  });

  it("pickColumnSet(89) drops into COLUMNS_80 (narrow)", () => {
    expect(pickColumnSet(89)).toBe(COLUMNS_80);
  });

  it("pickColumnSet(119) remains in COLUMNS_100 (medium ceiling)", () => {
    expect(pickColumnSet(119)).toBe(COLUMNS_100);
  });

  it("pickColumnSet(120) flips to COLUMNS_140 (wide floor)", () => {
    expect(pickColumnSet(120)).toBe(COLUMNS_140);
  });

  it("COLUMNS_100 does not contain a column with id 'started'", () => {
    expect(COLUMNS_100.some((c) => c.id === "started")).toBe(false);
  });

  it("COLUMNS_100 exposes the AGE header via the elapsed-id column", () => {
    const elapsed = COLUMNS_100.find((c) => c.id === "elapsed");
    expect(elapsed).toBeDefined();
    expect(elapsed!.header).toBe("AGE");
  });

  it("NOTE column has grow: true", () => {
    const noteCol = COLUMNS_100.find((c) => c.id === "note");
    expect(noteCol?.grow).toBe(true);
  });

  it("COLUMNS_100 contains exactly the ordered id set [id, workflow, status, step, elapsed, note]", () => {
    expect(COLUMNS_100.map((c) => c.id)).toEqual([
      "id",
      "workflow",
      "status",
      "step",
      "elapsed",
      "note",
    ]);
  });
});
