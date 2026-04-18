import { describe, it, expect } from "vitest";
import { computeWindow } from "../../src/primitives/compute-window.js";

function w(rowCount: number, cursor: number, offset: number, visibleRows: number) {
  return computeWindow({ rowCount, cursor, offset, visibleRows });
}

describe("computeWindow", () => {
  describe("degenerate inputs", () => {
    it("rowCount=0 returns zeroed state", () => {
      expect(w(0, 0, 0, 5)).toEqual({ offset: 0, visibleRows: 5, cursor: 0 });
    });

    it("visibleRows=0 returns zero offset and cursor", () => {
      expect(w(10, 3, 0, 0)).toEqual({ offset: 0, visibleRows: 0, cursor: 0 });
    });

    it("both zero", () => {
      expect(w(0, 0, 0, 0)).toEqual({ offset: 0, visibleRows: 0, cursor: 0 });
    });

    it("negative visibleRows clamped to 0", () => {
      expect(w(10, 3, 0, -5)).toEqual({ offset: 0, visibleRows: 0, cursor: 0 });
    });
  });

  describe("no scrolling needed", () => {
    it("rowCount equals visibleRows", () => {
      expect(w(5, 2, 0, 5)).toEqual({ offset: 0, visibleRows: 5, cursor: 2 });
    });

    it("rowCount less than visibleRows", () => {
      expect(w(3, 1, 0, 10)).toEqual({ offset: 0, visibleRows: 10, cursor: 1 });
    });
  });

  describe("cursor at boundaries", () => {
    it("cursor=0 keeps offset at 0", () => {
      expect(w(20, 0, 0, 5)).toEqual({ offset: 0, visibleRows: 5, cursor: 0 });
    });

    it("cursor at last row scrolls offset to end", () => {
      expect(w(20, 19, 0, 5)).toEqual({ offset: 15, visibleRows: 5, cursor: 19 });
    });
  });

  describe("scroll down", () => {
    it("cursor below viewport adjusts offset", () => {
      expect(w(20, 8, 0, 5)).toEqual({ offset: 4, visibleRows: 5, cursor: 8 });
    });

    it("cursor just past bottom edge", () => {
      expect(w(20, 5, 0, 5)).toEqual({ offset: 1, visibleRows: 5, cursor: 5 });
    });
  });

  describe("scroll up", () => {
    it("cursor above viewport sets offset to cursor", () => {
      expect(w(20, 2, 10, 5)).toEqual({ offset: 2, visibleRows: 5, cursor: 2 });
    });
  });

  describe("offset clamping", () => {
    it("offset exceeding max is clamped", () => {
      expect(w(10, 5, 100, 5)).toEqual({ offset: 5, visibleRows: 5, cursor: 5 });
    });

    it("negative offset is clamped to 0", () => {
      expect(w(10, 0, -5, 5)).toEqual({ offset: 0, visibleRows: 5, cursor: 0 });
    });
  });

  describe("cursor clamping", () => {
    it("negative cursor clamped to 0", () => {
      expect(w(10, -3, 0, 5)).toEqual({ offset: 0, visibleRows: 5, cursor: 0 });
    });

    it("cursor beyond rowCount clamped to last", () => {
      expect(w(10, 50, 0, 5)).toEqual({ offset: 5, visibleRows: 5, cursor: 9 });
    });
  });

  describe("single row", () => {
    it("rowCount=1, visibleRows=1", () => {
      expect(w(1, 0, 0, 1)).toEqual({ offset: 0, visibleRows: 1, cursor: 0 });
    });
  });
});
