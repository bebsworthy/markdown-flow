// test/runs/cursor.test.ts
//
// Pure unit tests for the cursor helpers (P5-T3). No ink/react imports —
// these functions are referenced by both the reducer's component layer
// and the reducer-adjacent reconcile effect in <RunsTable>.
//
// References: docs/tui/plans/P5-T3.md §4, §9.1.

import { describe, it, expect } from "vitest";
import {
  clampCursor,
  jumpCursorTo,
  moveCursor,
  reconcileCursorAfterRowsChange,
  rowIdAtCursor,
} from "../../src/runs/cursor.js";

describe("clampCursor", () => {
  it("clamps negative into 0", () => {
    expect(clampCursor(-1, 5)).toBe(0);
  });
  it("clamps above upper bound to rowCount - 1", () => {
    expect(clampCursor(10, 5)).toBe(4);
  });
  it("passes through valid index", () => {
    expect(clampCursor(2, 5)).toBe(2);
  });
  it("rowCount=0 always returns 0", () => {
    expect(clampCursor(0, 0)).toBe(0);
    expect(clampCursor(-5, 0)).toBe(0);
    expect(clampCursor(100, 0)).toBe(0);
  });
  it("floors floats", () => {
    expect(clampCursor(1.9, 5)).toBe(1);
  });
  it("non-finite inputs collapse to 0", () => {
    expect(clampCursor(Number.NaN, 5)).toBe(0);
    expect(clampCursor(Number.POSITIVE_INFINITY, 5)).toBe(0);
  });
});

describe("moveCursor", () => {
  it("positive delta increments", () => {
    expect(moveCursor(3, 1, 10)).toBe(4);
  });
  it("negative delta does not go below 0", () => {
    expect(moveCursor(0, -1, 10)).toBe(0);
  });
  it("positive overshoot clamps to last index", () => {
    expect(moveCursor(9, 5, 10)).toBe(9);
  });
  it("delta=0 returns the clamped cursor unchanged", () => {
    expect(moveCursor(3, 0, 10)).toBe(3);
  });
  it("large negative delta clamps to 0", () => {
    expect(moveCursor(3, -100, 10)).toBe(0);
  });
  it("rowCount=0 always returns 0", () => {
    expect(moveCursor(3, 1, 0)).toBe(0);
    expect(moveCursor(3, -1, 0)).toBe(0);
  });
});

describe("jumpCursorTo", () => {
  it("jumps to an in-range index", () => {
    expect(jumpCursorTo(7, 10)).toBe(7);
  });
  it("clamps negative to 0", () => {
    expect(jumpCursorTo(-5, 10)).toBe(0);
  });
  it("clamps above bound to last index", () => {
    expect(jumpCursorTo(100, 10)).toBe(9);
  });
  it("rowCount=0 returns 0", () => {
    expect(jumpCursorTo(0, 0)).toBe(0);
  });
});

describe("rowIdAtCursor", () => {
  it("returns id at index", () => {
    expect(rowIdAtCursor([{ id: "a" }, { id: "b" }], 1)).toBe("b");
  });
  it("returns null for empty rows", () => {
    expect(rowIdAtCursor([], 0)).toBeNull();
  });
  it("returns null for out-of-range positive index", () => {
    expect(rowIdAtCursor([{ id: "a" }], 5)).toBeNull();
  });
  it("returns null for negative index", () => {
    expect(rowIdAtCursor([{ id: "a" }], -1)).toBeNull();
  });
});

describe("reconcileCursorAfterRowsChange", () => {
  it("empty next rows → 0", () => {
    expect(reconcileCursorAfterRowsChange(2, null, [])).toBe(0);
  });
  it("selected id still present → cursor follows id", () => {
    expect(
      reconcileCursorAfterRowsChange(2, "b", [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]),
    ).toBe(1);
  });
  it("selected id gone → clamps prevCursor into new range", () => {
    expect(
      reconcileCursorAfterRowsChange(2, "x", [{ id: "a" }, { id: "b" }]),
    ).toBe(1);
  });
  it("id moved across the new list", () => {
    expect(
      reconcileCursorAfterRowsChange(2, "b", [
        { id: "c" },
        { id: "b" },
        { id: "d" },
      ]),
    ).toBe(1);
  });
  it("null prevRunId falls back to clamp-at-highest rule", () => {
    // prevCursor 5 but only 3 rows → last index = 2.
    expect(
      reconcileCursorAfterRowsChange(5, null, [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]),
    ).toBe(2);
  });
  it("prevCursor still valid → keep it", () => {
    expect(
      reconcileCursorAfterRowsChange(1, null, [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]),
    ).toBe(1);
  });
});
