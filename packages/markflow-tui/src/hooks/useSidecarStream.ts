// src/hooks/useSidecarStream.ts
//
// React hook that subscribes to the `markflow` engine's `getSidecarStream`
// and invokes `onLine` for each decoded line. The stream is re-opened
// whenever `(runDir, stepSeq, nodeId, stream)` changes and cancelled on
// unmount. A `streamFactory` test seam replaces the real `getSidecarStream`.
//
// The ONLY hook in P6-T3 that touches node I/O (via `markflow`).

import { useEffect, useRef, useState } from "react";
import { getSidecarStream as defaultGetSidecarStream } from "markflow-cli";
import type { LogStream } from "../log/types.js";

export type SidecarState = "idle" | "reading" | "done" | "error";

export type StreamFactory = (
  runDir: string,
  seq: number,
  stream: LogStream,
) => Promise<ReadableStream<Uint8Array>>;

export interface UseSidecarStreamOptions {
  readonly runDir: string | null;
  readonly stepSeq: number | null;
  readonly nodeId: string | null;
  readonly stream: LogStream;
  readonly enabled: boolean;
  readonly onLine: (line: string, lineIndex: number) => void;
  /** Called once with the trailing partial at EOF (no trailing newline). */
  readonly onPartial?: (partial: string) => void;
  readonly streamFactory?: StreamFactory;
}

export interface UseSidecarStreamResult {
  readonly state: SidecarState;
  readonly bytesRead: number;
  readonly error: Error | null;
}

export function useSidecarStream(
  opts: UseSidecarStreamOptions,
): UseSidecarStreamResult {
  const [state, setState] = useState<SidecarState>("idle");
  const [bytesRead, setBytesRead] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);

  const onLineRef = useRef(opts.onLine);
  onLineRef.current = opts.onLine;
  const onPartialRef = useRef(opts.onPartial);
  onPartialRef.current = opts.onPartial;

  const { runDir, stepSeq, nodeId, stream, enabled, streamFactory } = opts;

  useEffect(() => {
    if (!enabled || runDir === null || stepSeq === null || nodeId === null) {
      setState("idle");
      return;
    }
    setState("reading");
    setBytesRead(0);
    setError(null);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const factory = streamFactory ?? defaultGetSidecarStream;

    void (async () => {
      try {
        const rs = await factory(runDir, stepSeq, stream);
        if (controller.signal.aborted) {
          await rs.cancel().catch(() => undefined);
          return;
        }
        reader = rs.getReader();
        const decoder = new TextDecoder("utf-8");
        let buf = "";
        let idx = 0;
        let totalBytes = 0;
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split("\n");
            buf = parts.pop() ?? "";
            for (const p of parts) {
              onLineRef.current(p, idx);
              idx += 1;
            }
          }
        }
        buf += decoder.decode();
        if (!controller.signal.aborted) {
          if (buf.length > 0) {
            if (onPartialRef.current) onPartialRef.current(buf);
            else {
              onLineRef.current(buf, idx);
            }
          }
          setBytesRead(totalBytes);
          setState("done");
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err as Error);
          setState("error");
        }
      }
    })();

    return (): void => {
      controller.abort();
      if (reader) {
        reader.cancel().catch(() => undefined);
      }
    };
  }, [runDir, stepSeq, nodeId, stream, enabled, streamFactory]);

  return { state, bytesRead, error };
}
