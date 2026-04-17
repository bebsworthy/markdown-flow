// src/log/ingest.ts
//
// Pure helpers for turning engine `step:output` events + sidecar bytes into
// `LogLine[]` payloads for the reducer.
//
// PURITY NOTE: only type-only imports from `markflow`; no fs/react/ink.

import type { EngineEvent } from "markflow";
import { parseAnsi, stripAnsi } from "./ansi.js";
import type { LogLine, LogStream } from "./types.js";

export interface IngestTarget {
  readonly stepSeq: number;
  readonly nodeId: string;
}

export interface IngestCounter {
  readonly counts: Readonly<Record<LogStream, number>>;
}

/**
 * Pop the matching `step:output` chunks from an engine-event slice, append
 * to an existing buffered partial, split on newlines, parse ANSI, and emit
 * `LogLine` entries.
 *
 * Returns:
 *   - `lines`: new complete lines to append.
 *   - `partialByStream`: updated tail buffers per stream.
 *   - `nextCounts`: updated per-stream line counters.
 */
export function appendEventLines(
  events: readonly EngineEvent[],
  target: IngestTarget,
  partialByStream: Readonly<Record<LogStream, string>>,
  counters: Readonly<Record<LogStream, number>>,
): {
  readonly lines: LogLine[];
  readonly partialByStream: Readonly<Record<LogStream, string>>;
  readonly nextCounts: Readonly<Record<LogStream, number>>;
} {
  const lines: LogLine[] = [];
  let stdoutBuf = partialByStream.stdout;
  let stderrBuf = partialByStream.stderr;
  let stdoutCount = counters.stdout;
  let stderrCount = counters.stderr;

  for (const ev of events) {
    if (ev.type !== "step:output") continue;
    if (ev.nodeId !== target.nodeId) continue;
    const stream = ev.stream;
    const merged = (stream === "stdout" ? stdoutBuf : stderrBuf) + ev.chunk;
    const parts = merged.split("\n");
    const tail = parts.pop() ?? "";
    for (const raw of parts) {
      const { segments } = parseAnsi(raw);
      const plain = stripAnsi(raw);
      const lineIndex = stream === "stdout" ? stdoutCount : stderrCount;
      lines.push({
        seq: target.stepSeq,
        lineIndex,
        stream,
        ts: ev.ts,
        segments,
        rawLength: plain.length,
      });
      if (stream === "stdout") stdoutCount += 1;
      else stderrCount += 1;
    }
    if (stream === "stdout") stdoutBuf = tail;
    else stderrBuf = tail;
  }

  return {
    lines,
    partialByStream: { stdout: stdoutBuf, stderr: stderrBuf },
    nextCounts: { stdout: stdoutCount, stderr: stderrCount },
  };
}

/**
 * Merge sidecar-read lines with ring-derived lines, deduplicating by
 * `(stream, lineIndex)` so the two feeders never double-print. Preserves
 * the original order of `ringLines` as the authoritative sequence.
 */
export function mergeSidecarTail(
  sidecarLines: readonly LogLine[],
  ringLines: readonly LogLine[],
): LogLine[] {
  const seen = new Set<string>();
  const out: LogLine[] = [];
  const key = (l: LogLine): string => `${l.stream}:${l.lineIndex}`;
  for (const l of sidecarLines) {
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  for (const l of ringLines) {
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/**
 * Parse a raw sidecar text block (no trailing-newline split state — sidecar
 * files are read once and closed) into `LogLine` entries. `baseLineIndex`
 * is the starting lineIndex for this stream.
 */
export function parseSidecarText(
  text: string,
  target: IngestTarget,
  stream: LogStream,
  baseLineIndex: number,
): LogLine[] {
  if (text.length === 0) return [];
  // Drop a single trailing newline so we don't emit a spurious empty line
  // at EOF — matches typical shell output where the last line ends with \n.
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  const parts = trimmed.split("\n");
  const out: LogLine[] = [];
  let idx = baseLineIndex;
  for (const raw of parts) {
    const { segments } = parseAnsi(raw);
    const plain = stripAnsi(raw);
    out.push({
      seq: target.stepSeq,
      lineIndex: idx,
      stream,
      ts: null,
      segments,
      rawLength: plain.length,
    });
    idx += 1;
  }
  return out;
}
