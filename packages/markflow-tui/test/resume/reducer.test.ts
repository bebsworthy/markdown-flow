// test/resume/reducer.test.ts
//
// Unit tests for the pure resume-form reducer (P7-T2 §4.1).

import { describe, it, expect } from "vitest";
import type {
  InputRow,
  RerunNode,
  ResumeFormState,
} from "../../src/resume/types.js";

function makeNodes(n: number): RerunNode[] {
  return Array.from({ length: n }, (_, i) => ({
    nodeId: `n${i}`,
    tokenId: `t${i}`,
    state: i === 0 ? "error" : "complete",
    summary: "",
    preselected: i === 0,
  }));
}

function makeInputs(n: number): InputRow[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    original: `o${i}`,
    draft: `o${i}`,
    edited: false,
    required: false,
  }));
}

describe("initialResumeFormState", () => {
  it("seeds rerun from preselected nodes and inputs from drafts", async () => {
    const { initialResumeFormState } = await import("../../src/resume/reducer.js");
    const s = initialResumeFormState({
      nodes: makeNodes(3),
      inputs: makeInputs(2),
    });
    expect(s.focus).toBe("rerun");
    expect(s.rerunCursor).toBe(0);
    expect(s.inputsCursor).toBe(0);
    expect(s.fsm).toBe("idle");
    expect(s.error).toBeNull();
    expect([...s.rerun]).toEqual(["n0"]);
    expect(s.inputs).toEqual({ k0: "o0", k1: "o1" });
  });
});

describe("resumeFormReducer", () => {
  const env = { nodeCount: 3, inputCount: 2 };

  async function reducer() {
    return (await import("../../src/resume/reducer.js")).resumeFormReducer;
  }

  async function init() {
    const { initialResumeFormState } = await import("../../src/resume/reducer.js");
    return initialResumeFormState({ nodes: makeNodes(3), inputs: makeInputs(2) });
  }

  it("Tab cycles rerun → inputs → confirm → rerun", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "FOCUS_NEXT" }, env);
    expect(s.focus).toBe("inputs");
    s = r(s, { type: "FOCUS_NEXT" }, env);
    expect(s.focus).toBe("confirm");
    s = r(s, { type: "FOCUS_NEXT" }, env);
    expect(s.focus).toBe("rerun");
  });

  it("FOCUS_PREV cycles in reverse", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "FOCUS_PREV" }, env);
    expect(s.focus).toBe("confirm");
    s = r(s, { type: "FOCUS_PREV" }, env);
    expect(s.focus).toBe("inputs");
  });

  it("CURSOR_MOVE wraps inside the focused section only", async () => {
    const r = await reducer();
    let s = await init();
    // rerun focus: 3 nodes, -1 wraps to 2
    s = r(s, { type: "CURSOR_MOVE", delta: -1 }, env);
    expect(s.rerunCursor).toBe(2);
    expect(s.inputsCursor).toBe(0); // untouched
    s = r(s, { type: "CURSOR_MOVE", delta: 1 }, env);
    expect(s.rerunCursor).toBe(0);

    // switch to inputs; rerunCursor untouched
    s = r(s, { type: "FOCUS_NEXT" }, env);
    s = r(s, { type: "CURSOR_MOVE", delta: 1 }, env);
    expect(s.inputsCursor).toBe(1);
    expect(s.rerunCursor).toBe(0);
  });

  it("CURSOR_MOVE on confirm focus is a no-op", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "FOCUS_NEXT" }, env);
    s = r(s, { type: "FOCUS_NEXT" }, env);
    expect(s.focus).toBe("confirm");
    const next = r(s, { type: "CURSOR_MOVE", delta: 5 }, env);
    expect(next).toBe(s);
  });

  it("INPUT_EDIT updates draft; subsequent same value is a no-op", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "INPUT_EDIT", key: "k0", value: "new" }, env);
    expect(s.inputs.k0).toBe("new");
    const again = r(s, { type: "INPUT_EDIT", key: "k0", value: "new" }, env);
    expect(again).toBe(s);
  });

  it("SUBMIT_START is idempotent when already submitting", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "SUBMIT_START" }, env);
    expect(s.fsm).toBe("submitting");
    const again = r(s, { type: "SUBMIT_START" }, env);
    expect(again).toBe(s);
  });

  it("SUBMIT_FAIL preserves cursor, focus, and rerun set", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "CURSOR_MOVE", delta: 1 }, env);
    s = r(s, { type: "FOCUS_NEXT" }, env);
    s = r(s, { type: "SUBMIT_START" }, env);
    const pre = s;
    s = r(s, { type: "SUBMIT_FAIL", error: "boom" }, env);
    expect(s.fsm).toBe("error");
    expect(s.error).toBe("boom");
    expect(s.rerunCursor).toBe(pre.rerunCursor);
    expect(s.focus).toBe(pre.focus);
    expect(s.rerun).toBe(pre.rerun);
  });

  it("SUBMIT_OK resets FSM to idle with error cleared", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "SUBMIT_START" }, env);
    s = r(s, { type: "SUBMIT_OK" }, env);
    expect(s.fsm).toBe("idle");
    expect(s.error).toBeNull();
  });

  it("while submitting, cursor-move / focus actions are ignored", async () => {
    const r = await reducer();
    let s = await init();
    s = r(s, { type: "SUBMIT_START" }, env);
    const pre = s;
    const after = r(s, { type: "CURSOR_MOVE", delta: 1 }, env);
    expect(after).toBe(pre);
    const after2 = r(s, { type: "FOCUS_NEXT" }, env);
    expect(after2).toBe(pre);
  });

  it("returns a ResumeFormState with required keys", async () => {
    const s = await init();
    const keys: (keyof ResumeFormState)[] = [
      "focus",
      "rerunCursor",
      "inputsCursor",
      "rerun",
      "inputs",
      "fsm",
      "error",
    ];
    for (const k of keys) expect(k in s).toBe(true);
  });
});
