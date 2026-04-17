// test/palette/reducer.test.ts
import { describe, it, expect } from "vitest";
import {
  initialPaletteState,
  paletteReducer,
} from "../../src/palette/reducer.js";

describe("paletteReducer", () => {
  it("clamps cursor to [0, matchCount-1]", () => {
    const s1 = paletteReducer(
      initialPaletteState,
      { type: "CURSOR_MOVE", delta: 5 },
      { matchCount: 3 },
    );
    expect(s1.cursor).toBe(2);
    const s2 = paletteReducer(
      s1,
      { type: "CURSOR_MOVE", delta: -10 },
      { matchCount: 3 },
    );
    expect(s2.cursor).toBe(0);
  });

  it("CURSOR_RESET_TO_FIRST sets cursor 0", () => {
    const s1 = paletteReducer(
      { ...initialPaletteState, cursor: 2 },
      { type: "CURSOR_RESET_TO_FIRST" },
      { matchCount: 5 },
    );
    expect(s1.cursor).toBe(0);
  });

  it("RUN_START idempotent while running", () => {
    const s1 = paletteReducer(
      initialPaletteState,
      { type: "RUN_START" },
      { matchCount: 1 },
    );
    expect(s1.fsm).toBe("running");
    const s2 = paletteReducer(s1, { type: "RUN_START" }, { matchCount: 1 });
    expect(s2).toBe(s1);
  });

  it("RUN_FAIL → error with message", () => {
    const s = paletteReducer(
      { ...initialPaletteState, fsm: "running" },
      { type: "RUN_FAIL", error: "boom" },
      { matchCount: 1 },
    );
    expect(s.fsm).toBe("error");
    expect(s.error).toBe("boom");
  });

  it("RUN_OK → idle", () => {
    const s = paletteReducer(
      { ...initialPaletteState, fsm: "running" },
      { type: "RUN_OK" },
      { matchCount: 1 },
    );
    expect(s.fsm).toBe("idle");
    expect(s.error).toBeNull();
  });
});
