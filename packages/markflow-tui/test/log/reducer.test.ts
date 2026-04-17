// test/log/reducer.test.ts

import { describe, it, expect } from "vitest";
import {
  initialLogPanelState,
  linesSincePause,
  logReducer,
} from "../../src/log/reducer.js";
import type { LogLine, LogPanelState, LogStream } from "../../src/log/types.js";
import { LOG_RING_CAP } from "../../src/log/types.js";

function line(lineIndex: number, stream: LogStream = "stdout"): LogLine {
  return {
    seq: 10,
    lineIndex,
    stream,
    ts: null,
    segments: [{ text: `line-${lineIndex}` }],
    rawLength: 6 + String(lineIndex).length,
  };
}

function appendN(state: LogPanelState, n: number): LogPanelState {
  const lines: LogLine[] = [];
  const start = state.lines.length + state.dropped;
  for (let i = 0; i < n; i++) lines.push(line(start + i));
  return logReducer(state, { type: "APPEND_LINES", lines });
}

describe("logReducer", () => {
  it("initial state follows with empty lines", () => {
    expect(initialLogPanelState.follow).toBe(true);
    expect(initialLogPanelState.lines.length).toBe(0);
    expect(initialLogPanelState.cursor).toBe(0);
  });

  it("APPEND_LINES appends and moves cursor to head when following", () => {
    const s = appendN(initialLogPanelState, 3);
    expect(s.lines.length).toBe(3);
    expect(s.cursor).toBe(2);
  });

  it("APPEND_LINES is a no-op when passed an empty array", () => {
    const s = logReducer(initialLogPanelState, { type: "APPEND_LINES", lines: [] });
    expect(s).toBe(initialLogPanelState);
  });

  it("APPEND_LINES caps ring at LOG_RING_CAP and increments dropped", () => {
    let s: LogPanelState = initialLogPanelState;
    s = appendN(s, LOG_RING_CAP);
    expect(s.lines.length).toBe(LOG_RING_CAP);
    expect(s.dropped).toBe(0);
    s = appendN(s, 5);
    expect(s.lines.length).toBe(LOG_RING_CAP);
    expect(s.dropped).toBe(5);
  });

  it("APPEND_LINES while paused keeps cursor frozen", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -2 });
    expect(s.follow).toBe(false);
    const cursorBefore = s.cursor;
    s = appendN(s, 10);
    expect(s.cursor).toBe(cursorBefore);
    expect(s.lines.length).toBe(15);
  });

  it("SCROLL_DELTA upward while following auto-pauses", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -1 });
    expect(s.follow).toBe(false);
    expect(s.pausedAtHeadSeq).not.toBeNull();
    expect(s.cursor).toBe(3);
  });

  it("SCROLL_DELTA downward to head while paused auto-resumes", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -2 });
    expect(s.follow).toBe(false);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: 2 });
    expect(s.follow).toBe(true);
    expect(s.cursor).toBe(4);
  });

  it("SCROLL_JUMP_HEAD resumes follow and moves to head", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -3 });
    s = logReducer(s, { type: "SCROLL_JUMP_HEAD" });
    expect(s.follow).toBe(true);
    expect(s.cursor).toBe(4);
  });

  it("SCROLL_JUMP_TOP moves to 0 and pauses", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_JUMP_TOP" });
    expect(s.follow).toBe(false);
    expect(s.cursor).toBe(0);
  });

  it("SCROLL_PAGE respects pageSize", () => {
    let s = appendN(initialLogPanelState, 50);
    s = logReducer(s, { type: "SCROLL_PAGE", direction: "up", pageSize: 10 });
    expect(s.follow).toBe(false);
    expect(s.cursor).toBe(39);
  });

  it("SET_FOLLOW(true) jumps to head and clears pause state", () => {
    let s = appendN(initialLogPanelState, 5);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -4 });
    s = logReducer(s, { type: "SET_FOLLOW", follow: true });
    expect(s.follow).toBe(true);
    expect(s.pausedAtHeadSeq).toBeNull();
    expect(s.cursor).toBe(4);
  });

  it("SET_FOLLOW(false) records pause point", () => {
    let s = appendN(initialLogPanelState, 3);
    s = logReducer(s, { type: "SET_FOLLOW", follow: false });
    expect(s.follow).toBe(false);
    expect(s.pausedAtHeadSeq).toBe(2);
  });

  it("SET_WRAP toggles without touching cursor", () => {
    let s = appendN(initialLogPanelState, 3);
    const c = s.cursor;
    s = logReducer(s, { type: "SET_WRAP", wrap: true });
    expect(s.settings.wrap).toBe(true);
    expect(s.cursor).toBe(c);
  });

  it("SET_STREAM_FILTER mutates settings", () => {
    const s = logReducer(initialLogPanelState, {
      type: "SET_STREAM_FILTER",
      filter: "stderr",
    });
    expect(s.settings.streamFilter).toBe("stderr");
  });

  it("SET_PARTIAL stores tail buffer", () => {
    const s = logReducer(initialLogPanelState, {
      type: "SET_PARTIAL",
      stream: "stdout",
      buf: "partial",
    });
    expect(s.partialByStream.stdout).toBe("partial");
  });

  it("RESET returns initial state", () => {
    let s = appendN(initialLogPanelState, 10);
    s = logReducer(s, { type: "SET_WRAP", wrap: true });
    s = logReducer(s, { type: "RESET" });
    expect(s).toBe(initialLogPanelState);
  });

  it("linesSincePause counts appends after pause", () => {
    let s = appendN(initialLogPanelState, 3);
    s = logReducer(s, { type: "SET_FOLLOW", follow: false });
    s = appendN(s, 7);
    expect(linesSincePause(s)).toBe(7);
  });

  it("linesSincePause is 0 while following", () => {
    const s = appendN(initialLogPanelState, 3);
    expect(linesSincePause(s)).toBe(0);
  });

  it("SCROLL_DELTA=0 is a no-op", () => {
    const s = appendN(initialLogPanelState, 3);
    expect(logReducer(s, { type: "SCROLL_DELTA", delta: 0 })).toBe(s);
  });
});
