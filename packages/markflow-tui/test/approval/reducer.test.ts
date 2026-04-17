// test/approval/reducer.test.ts

import { describe, it, expect } from "vitest";
import {
  approvalFormReducer,
  initialApprovalFormState,
} from "../../src/approval/reducer.js";

describe("approvalFormReducer", () => {
  const OPTS = ["a", "b", "c"];

  it("initial state starts at cursor 0, idle", () => {
    const s = initialApprovalFormState(OPTS);
    expect(s).toEqual({ cursor: 0, fsm: "idle", error: null });
  });

  it("CURSOR_MOVE wraps at both ends", () => {
    const s0 = initialApprovalFormState(OPTS);
    const s1 = approvalFormReducer(s0, { type: "CURSOR_MOVE", delta: -1 }, OPTS.length);
    expect(s1.cursor).toBe(OPTS.length - 1);
    const s2 = approvalFormReducer(s1, { type: "CURSOR_MOVE", delta: 1 }, OPTS.length);
    expect(s2.cursor).toBe(0);
    const s3 = approvalFormReducer(s2, { type: "CURSOR_MOVE", delta: 5 }, OPTS.length);
    expect(s3.cursor).toBe(5 % OPTS.length);
  });

  it("SUBMIT_START transitions idle → submitting; re-entry is a no-op", () => {
    const s0 = initialApprovalFormState(OPTS);
    const s1 = approvalFormReducer(s0, { type: "SUBMIT_START" }, OPTS.length);
    expect(s1.fsm).toBe("submitting");
    const s2 = approvalFormReducer(s1, { type: "SUBMIT_START" }, OPTS.length);
    expect(s2).toBe(s1);
  });

  it("SUBMIT_FAIL preserves cursor + surfaces error string", () => {
    const s0: ReturnType<typeof initialApprovalFormState> = {
      cursor: 2,
      fsm: "submitting",
      error: null,
    };
    const s1 = approvalFormReducer(
      s0,
      { type: "SUBMIT_FAIL", error: "boom" },
      OPTS.length,
    );
    expect(s1.fsm).toBe("error");
    expect(s1.error).toBe("boom");
    expect(s1.cursor).toBe(2);
  });

  it("SUBMIT_OK returns to idle", () => {
    const s0 = { cursor: 1, fsm: "submitting" as const, error: null };
    const s1 = approvalFormReducer(s0, { type: "SUBMIT_OK" }, OPTS.length);
    expect(s1.fsm).toBe("idle");
    expect(s1.error).toBeNull();
  });

  it("CURSOR_MOVE ignored while submitting", () => {
    const s0 = { cursor: 0, fsm: "submitting" as const, error: null };
    const s1 = approvalFormReducer(
      s0,
      { type: "CURSOR_MOVE", delta: 1 },
      OPTS.length,
    );
    expect(s1).toBe(s0);
  });
});
