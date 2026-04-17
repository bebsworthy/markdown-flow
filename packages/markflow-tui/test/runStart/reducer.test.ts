// test/runStart/reducer.test.ts
//
// Unit tests for `runStart/reducer.ts` (P9-T1).

import { describe, it, expect } from "vitest";
import {
  initialRunInputFormState,
  runInputFormReducer,
} from "../../src/runStart/reducer.js";
import type { RunInputRow } from "../../src/runStart/types.js";

function row(key: string, required = false): RunInputRow {
  return { key, description: "", required, placeholder: "", draft: "" };
}

describe("initialRunInputFormState", () => {
  it("seeds rows, cursor 0, fsm idle, no error", () => {
    const rows = [row("a"), row("b")];
    expect(initialRunInputFormState(rows)).toEqual({
      rows,
      cursor: 0,
      fsm: "idle",
      error: null,
    });
  });
});

describe("runInputFormReducer", () => {
  const rows = [row("a"), row("b"), row("c")];
  const s0 = initialRunInputFormState(rows);

  it("CURSOR_MOVE clamps to [0, rows.length-1]", () => {
    expect(runInputFormReducer(s0, { type: "CURSOR_MOVE", delta: 1 }).cursor).toBe(1);
    expect(runInputFormReducer(s0, { type: "CURSOR_MOVE", delta: -5 }).cursor).toBe(0);
    expect(runInputFormReducer({ ...s0, cursor: 2 }, { type: "CURSOR_MOVE", delta: 5 }).cursor).toBe(2);
  });

  it("CURSOR_SET clamps identically", () => {
    expect(runInputFormReducer(s0, { type: "CURSOR_SET", index: 7 }).cursor).toBe(2);
    expect(runInputFormReducer(s0, { type: "CURSOR_SET", index: -1 }).cursor).toBe(0);
  });

  it("SET_DRAFT updates only the matching key", () => {
    const next = runInputFormReducer(s0, {
      type: "SET_DRAFT",
      key: "b",
      value: "hi",
    });
    expect(next.rows[0]).toBe(s0.rows[0]);
    expect(next.rows[2]).toBe(s0.rows[2]);
    expect(next.rows[1]!.draft).toBe("hi");
  });

  it("SUBMIT_START → fsm submitting; idempotent when submitting", () => {
    const s1 = runInputFormReducer(s0, { type: "SUBMIT_START" });
    expect(s1.fsm).toBe("submitting");
    const s2 = runInputFormReducer(s1, { type: "SUBMIT_START" });
    expect(s2).toBe(s1);
  });

  it("SUBMIT_OK → fsm idle", () => {
    const s1 = runInputFormReducer(s0, { type: "SUBMIT_START" });
    const s2 = runInputFormReducer(s1, { type: "SUBMIT_OK" });
    expect(s2.fsm).toBe("idle");
    expect(s2.error).toBeNull();
  });

  it("SUBMIT_FAIL → fsm error with message", () => {
    const s1 = runInputFormReducer(s0, { type: "SUBMIT_START" });
    const s2 = runInputFormReducer(s1, { type: "SUBMIT_FAIL", error: "boom" });
    expect(s2.fsm).toBe("error");
    expect(s2.error).toBe("boom");
  });

  it("SET_DRAFT after failure resets fsm back to idle (soft reset)", () => {
    const s1 = runInputFormReducer(s0, { type: "SUBMIT_START" });
    const s2 = runInputFormReducer(s1, { type: "SUBMIT_FAIL", error: "boom" });
    const s3 = runInputFormReducer(s2, { type: "SET_DRAFT", key: "a", value: "x" });
    expect(s3.fsm).toBe("idle");
    expect(s3.error).toBeNull();
  });
});
