// test/help/reducer.test.ts
import { describe, it, expect } from "vitest";
import {
  helpReducer,
  initialHelpState,
} from "../../src/help/reducer.js";

describe("helpReducer", () => {
  it("SEARCH_SET resets cursor to 0", () => {
    const s = helpReducer(
      { search: "", cursor: 3 },
      { type: "SEARCH_SET", value: "abc" },
      { rowCount: 5 },
    );
    expect(s.search).toBe("abc");
    expect(s.cursor).toBe(0);
  });

  it("CURSOR_MOVE clamps", () => {
    const s1 = helpReducer(
      initialHelpState,
      { type: "CURSOR_MOVE", delta: 10 },
      { rowCount: 3 },
    );
    expect(s1.cursor).toBe(2);
    const s2 = helpReducer(
      s1,
      { type: "CURSOR_MOVE", delta: -10 },
      { rowCount: 3 },
    );
    expect(s2.cursor).toBe(0);
  });

  it("CURSOR_RESET sets cursor to 0", () => {
    const s = helpReducer(
      { search: "x", cursor: 4 },
      { type: "CURSOR_RESET" },
      { rowCount: 10 },
    );
    expect(s.cursor).toBe(0);
  });
});
