// test/log/derive.test.ts

import { describe, it, expect } from "vitest";
import { deriveLogModel, formatHeader } from "../../src/log/derive.js";
import {
  initialLogPanelState,
  logReducer,
} from "../../src/log/reducer.js";
import type { LogLine, LogPanelState, LogStream } from "../../src/log/types.js";

function line(i: number, stream: LogStream = "stdout"): LogLine {
  return {
    seq: 10,
    lineIndex: i,
    stream,
    ts: null,
    segments: [{ text: `line-${i}` }],
    rawLength: 6 + String(i).length,
  };
}

function seed(n: number): LogPanelState {
  const lines = Array.from({ length: n }, (_, i) => line(i));
  return logReducer(initialLogPanelState, { type: "APPEND_LINES", lines });
}

const TARGET = { nodeId: "build", stepSeq: 10 };

describe("deriveLogModel", () => {
  it("renders empty state with no target", () => {
    const m = deriveLogModel({
      state: initialLogPanelState,
      viewport: { width: 80, height: 10 },
      target: null,
      empty: { kind: "no-selection" },
    });
    expect(m.empty?.kind).toBe("no-selection");
    expect(m.rows.length).toBe(0);
  });

  it("following: shows the last `height - 2` lines", () => {
    const state = seed(20);
    const m = deriveLogModel({
      state,
      viewport: { width: 80, height: 10 },
      target: TARGET,
      empty: null,
    });
    // 10 height − 1 header − 1 footer = 8 log rows
    expect(m.rows.length).toBe(8);
    expect(m.rows[0]!.line.lineIndex).toBe(12);
    expect(m.rows[7]!.line.lineIndex).toBe(19);
    expect(m.isFollowing).toBe(true);
    expect(m.footer?.kind).toBe("live-tail");
    expect(m.banner).toBeNull();
  });

  it("paused: banner reports linesSincePause", () => {
    let s = seed(5);
    s = logReducer(s, { type: "SET_FOLLOW", follow: false });
    s = logReducer(s, {
      type: "APPEND_LINES",
      lines: Array.from({ length: 3 }, (_, i) => line(5 + i)),
    });
    const m = deriveLogModel({
      state: s,
      viewport: { width: 80, height: 12 },
      target: TARGET,
      empty: null,
    });
    expect(m.banner?.kind).toBe("paused");
    if (m.banner?.kind === "paused")
      expect(m.banner.linesSincePause).toBe(3);
    expect(m.isFollowing).toBe(false);
  });

  it("paused: footer reports more-below when cursor < head", () => {
    let s = seed(30);
    s = logReducer(s, { type: "SCROLL_DELTA", delta: -20 });
    const m = deriveLogModel({
      state: s,
      viewport: { width: 80, height: 10 },
      target: TARGET,
      empty: null,
    });
    expect(m.footer?.kind).toBe("more-below");
  });

  it("header reflects follow/paused state", () => {
    const s = seed(3);
    expect(formatHeader(TARGET, s)).toContain("following");
    const paused = logReducer(s, { type: "SET_FOLLOW", follow: false });
    expect(formatHeader(TARGET, paused)).toContain("paused");
  });

  it("truncate mode caps each line to width - gutter with ellipsis", () => {
    const state = logReducer(initialLogPanelState, {
      type: "APPEND_LINES",
      lines: [
        {
          seq: 10,
          lineIndex: 0,
          stream: "stdout",
          ts: null,
          segments: [{ text: "a".repeat(100) }],
          rawLength: 100,
        },
      ],
    });
    const m = deriveLogModel({
      state,
      viewport: { width: 20, height: 6 },
      target: TARGET,
      empty: null,
    });
    expect(m.rows[0]!.text.endsWith("\u2026")).toBe(true);
    expect(m.rows[0]!.text.length).toBe(18);
  });

  it("wrap mode splits a long line onto multiple rows", () => {
    const state = {
      ...logReducer(initialLogPanelState, {
        type: "APPEND_LINES",
        lines: [
          {
            seq: 10,
            lineIndex: 0,
            stream: "stdout",
            ts: null,
            segments: [{ text: "a".repeat(40) }],
            rawLength: 40,
          },
        ],
      }),
      settings: {
        streamFilter: "both",
        wrap: true,
        timestamps: false,
      },
    } as LogPanelState;
    const m = deriveLogModel({
      state,
      viewport: { width: 20, height: 10 },
      target: TARGET,
      empty: null,
    });
    expect(m.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("stream filter hides non-matching lines", () => {
    const lines = [line(0, "stdout"), line(1, "stderr"), line(2, "stdout")];
    const state = {
      ...logReducer(initialLogPanelState, { type: "APPEND_LINES", lines }),
      settings: {
        streamFilter: "stderr",
        wrap: false,
        timestamps: false,
      },
    } as LogPanelState;
    const m = deriveLogModel({
      state,
      viewport: { width: 80, height: 10 },
      target: TARGET,
      empty: null,
    });
    expect(m.rows.length).toBe(1);
    expect(m.rows[0]!.line.stream).toBe("stderr");
  });
});
