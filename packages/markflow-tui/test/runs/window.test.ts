// test/runs/window.test.ts
//
// Pure virtualisation math tests (P5-T2 §10.4).

import { describe, it, expect } from "vitest";
import {
  computeWindow,
  deriveVisibleRows,
  sliceWindow,
} from "../../src/runs/window.js";

describe("computeWindow — degenerate inputs", () => {
  it("rowCount=0 → empty window", () => {
    expect(computeWindow({ rowCount: 0, cursor: 5, offset: 2, visibleRows: 10 }))
      .toEqual({ offset: 0, visibleRows: 10, cursor: 0 });
  });

  it("visibleRows=0 → empty slice regardless of cursor", () => {
    expect(
      computeWindow({ rowCount: 100, cursor: 50, offset: 10, visibleRows: 0 }),
    ).toEqual({ offset: 0, visibleRows: 0, cursor: 0 });
  });

  it("visibleRows < 0 clamps to 0", () => {
    expect(
      computeWindow({ rowCount: 100, cursor: 10, offset: 5, visibleRows: -4 }),
    ).toEqual({ offset: 0, visibleRows: 0, cursor: 0 });
  });
});

describe("computeWindow — cursor-within-window", () => {
  it("cursor inside window → offset unchanged", () => {
    expect(
      computeWindow({ rowCount: 100, cursor: 15, offset: 10, visibleRows: 10 }),
    ).toEqual({ offset: 10, visibleRows: 10, cursor: 15 });
  });

  it("visibleRows >= rowCount → offset=0", () => {
    expect(
      computeWindow({ rowCount: 5, cursor: 3, offset: 2, visibleRows: 10 }),
    ).toEqual({ offset: 0, visibleRows: 10, cursor: 3 });
  });
});

describe("computeWindow — scroll-into-view", () => {
  it("cursor above window → offset = cursor", () => {
    expect(
      computeWindow({ rowCount: 100, cursor: 5, offset: 20, visibleRows: 10 }),
    ).toEqual({ offset: 5, visibleRows: 10, cursor: 5 });
  });

  it("cursor below window → offset = cursor - visibleRows + 1", () => {
    expect(
      computeWindow({ rowCount: 100, cursor: 25, offset: 5, visibleRows: 10 }),
    ).toEqual({ offset: 16, visibleRows: 10, cursor: 25 });
  });
});

describe("computeWindow — cursor clamping", () => {
  it("negative cursor clamped to 0", () => {
    const out = computeWindow({
      rowCount: 10,
      cursor: -3,
      offset: 0,
      visibleRows: 5,
    });
    expect(out.cursor).toBe(0);
  });

  it("out-of-range cursor clamped to rowCount-1", () => {
    const out = computeWindow({
      rowCount: 10,
      cursor: 42,
      offset: 0,
      visibleRows: 5,
    });
    expect(out.cursor).toBe(9);
    // Offset must keep cursor visible — last-page alignment.
    expect(out.offset).toBe(5);
  });
});

describe("computeWindow — monotonic scroll", () => {
  it("cursor 0→10 with visibleRows=5 yields offsets 0,0,0,0,0,1,2,3,4,5,6", () => {
    const rowCount = 100;
    const visibleRows = 5;
    let offset = 0;
    const observed: number[] = [];
    for (let cursor = 0; cursor <= 10; cursor += 1) {
      const win = computeWindow({ rowCount, cursor, offset, visibleRows });
      observed.push(win.offset);
      offset = win.offset;
    }
    expect(observed).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("sliceWindow", () => {
  it("returns fresh array (not the input)", () => {
    const rows = [1, 2, 3, 4, 5];
    const out = sliceWindow(rows, { offset: 1, visibleRows: 3 });
    expect(out).toEqual([2, 3, 4]);
    expect(out).not.toBe(rows);
  });

  it("identity when window covers all rows", () => {
    const rows = [1, 2, 3];
    const out = sliceWindow(rows, { offset: 0, visibleRows: 5 });
    expect(out).toEqual([1, 2, 3]);
  });

  it("empty slice when visibleRows=0", () => {
    expect(sliceWindow([1, 2, 3], { offset: 0, visibleRows: 0 })).toEqual([]);
  });
});

describe("deriveVisibleRows", () => {
  it("24 - 2 - 1 = 21", () => {
    expect(deriveVisibleRows(24, 2, 1)).toBe(21);
  });

  it("overhead consumes all height → 0", () => {
    expect(deriveVisibleRows(3, 2, 1)).toBe(0);
  });

  it("negative height → 0", () => {
    expect(deriveVisibleRows(-5, 2, 1)).toBe(0);
  });

  it("non-finite height → 0", () => {
    expect(deriveVisibleRows(Number.NaN, 2, 1)).toBe(0);
  });
});
