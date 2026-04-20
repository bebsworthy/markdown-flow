// test/log/ingest.test.ts

import { describe, it, expect } from "vitest";
import type { EngineEvent } from "markflow-cli";
import {
  appendEventLines,
  mergeSidecarTail,
  parseSidecarText,
} from "../../src/log/ingest.js";
import type { LogLine, LogStream } from "../../src/log/types.js";

function outEv(
  seq: number,
  nodeId: string,
  stream: LogStream,
  chunk: string,
): EngineEvent {
  return {
    seq,
    ts: "2026-04-17T12:00:00Z",
    type: "step:output",
    nodeId,
    stream,
    chunk,
  } as EngineEvent;
}

const EMPTY_PARTIAL = { stdout: "", stderr: "" };
const EMPTY_COUNTS = { stdout: 0, stderr: 0 };

describe("appendEventLines", () => {
  it("splits a single-chunk event on newlines", () => {
    const { lines, partialByStream, nextCounts } = appendEventLines(
      [outEv(5, "build", "stdout", "a\nb\nc\n")],
      { stepSeq: 5, nodeId: "build" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    expect(lines.map((l) => l.segments[0]!.text)).toEqual(["a", "b", "c"]);
    expect(partialByStream.stdout).toBe("");
    expect(nextCounts.stdout).toBe(3);
  });

  it("buffers a partial line without newline", () => {
    const { lines, partialByStream } = appendEventLines(
      [outEv(5, "n", "stdout", "hello")],
      { stepSeq: 5, nodeId: "n" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    expect(lines.length).toBe(0);
    expect(partialByStream.stdout).toBe("hello");
  });

  it("merges buffered partial across chunks", () => {
    const step1 = appendEventLines(
      [outEv(5, "n", "stdout", "hel")],
      { stepSeq: 5, nodeId: "n" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    const step2 = appendEventLines(
      [outEv(6, "n", "stdout", "lo\n")],
      { stepSeq: 5, nodeId: "n" },
      step1.partialByStream,
      step1.nextCounts,
    );
    expect(step2.lines.length).toBe(1);
    expect(step2.lines[0]!.segments[0]!.text).toBe("hello");
  });

  it("filters events by nodeId", () => {
    const { lines } = appendEventLines(
      [
        outEv(5, "other", "stdout", "x\n"),
        outEv(6, "n", "stdout", "y\n"),
      ],
      { stepSeq: 5, nodeId: "n" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    expect(lines.map((l) => l.segments[0]!.text)).toEqual(["y"]);
  });

  it("assigns per-stream lineIndex counters", () => {
    const { lines } = appendEventLines(
      [
        outEv(5, "n", "stdout", "a\n"),
        outEv(6, "n", "stderr", "e\n"),
        outEv(7, "n", "stdout", "b\n"),
      ],
      { stepSeq: 5, nodeId: "n" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    expect(lines.map((l) => `${l.stream}:${l.lineIndex}`)).toEqual([
      "stdout:0",
      "stderr:0",
      "stdout:1",
    ]);
  });

  it("parses ANSI colors inside a chunk", () => {
    const { lines } = appendEventLines(
      [outEv(5, "n", "stdout", "\x1b[31mred\x1b[0m\n")],
      { stepSeq: 5, nodeId: "n" },
      EMPTY_PARTIAL,
      EMPTY_COUNTS,
    );
    expect(lines[0]!.segments[0]!.color).toBe("red");
    expect(lines[0]!.rawLength).toBe(3);
  });
});

describe("mergeSidecarTail", () => {
  function mk(stream: LogStream, idx: number, text: string): LogLine {
    return {
      seq: 5,
      lineIndex: idx,
      stream,
      ts: null,
      segments: [{ text }],
      rawLength: text.length,
    };
  }

  it("deduplicates by (stream, lineIndex)", () => {
    const sidecar = [mk("stdout", 0, "a"), mk("stdout", 1, "b")];
    const ring = [mk("stdout", 1, "b"), mk("stdout", 2, "c")];
    const out = mergeSidecarTail(sidecar, ring);
    expect(out.map((l) => `${l.stream}:${l.lineIndex}`)).toEqual([
      "stdout:0",
      "stdout:1",
      "stdout:2",
    ]);
  });

  it("preserves stream label and order", () => {
    const out = mergeSidecarTail(
      [mk("stderr", 0, "e")],
      [mk("stdout", 0, "o")],
    );
    expect(out.length).toBe(2);
    expect(out[0]!.stream).toBe("stderr");
    expect(out[1]!.stream).toBe("stdout");
  });
});

describe("parseSidecarText", () => {
  it("splits on newlines and strips the final EOF newline", () => {
    const lines = parseSidecarText("a\nb\nc\n", { stepSeq: 5, nodeId: "n" }, "stdout", 0);
    expect(lines.length).toBe(3);
  });

  it("preserves a trailing line without newline", () => {
    const lines = parseSidecarText("a\nb", { stepSeq: 5, nodeId: "n" }, "stdout", 0);
    expect(lines.length).toBe(2);
    expect(lines[1]!.segments[0]!.text).toBe("b");
  });

  it("uses baseLineIndex as the starting counter", () => {
    const lines = parseSidecarText("x\n", { stepSeq: 5, nodeId: "n" }, "stdout", 42);
    expect(lines[0]!.lineIndex).toBe(42);
  });

  it("returns [] for empty input", () => {
    expect(parseSidecarText("", { stepSeq: 5, nodeId: "n" }, "stdout", 0)).toEqual([]);
  });
});
