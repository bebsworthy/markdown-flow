// test/hooks/useSidecarStream.test.tsx

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useSidecarStream } from "../../src/hooks/useSidecarStream.js";
import type { StreamFactory } from "../../src/hooks/useSidecarStream.js";
import { flush } from "../helpers/flush.js";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i]!));
      i += 1;
    },
  });
}

function Harness({
  factory,
  onLine,
  enabled,
}: {
  factory: StreamFactory;
  onLine: (s: string, i: number) => void;
  enabled: boolean;
}): React.ReactElement {
  const r = useSidecarStream({
    runDir: "/run",
    stepSeq: 1,
    nodeId: "n",
    stream: "stdout",
    enabled,
    onLine,
    streamFactory: factory,
  });
  return <Text>{r.state}</Text>;
}
describe("useSidecarStream", () => {
  it("calls onLine for each newline-terminated chunk", async () => {
    const factory: StreamFactory = async () => makeStream(["a\nb\n", "c\n"]);
    const onLine = vi.fn();
    const { unmount } = render(
      <Harness factory={factory} onLine={onLine} enabled={true} />,
    );
    await flush();
    expect(onLine).toHaveBeenCalledWith("a", 0);
    expect(onLine).toHaveBeenCalledWith("b", 1);
    expect(onLine).toHaveBeenCalledWith("c", 2);
    unmount();
  });

  it("flushes a trailing partial line at EOF (no onPartial)", async () => {
    const factory: StreamFactory = async () => makeStream(["tail"]);
    const onLine = vi.fn();
    const { unmount } = render(
      <Harness factory={factory} onLine={onLine} enabled={true} />,
    );
    await flush();
    expect(onLine).toHaveBeenCalledWith("tail", 0);
    unmount();
  });

  it("enabled:false does not open the stream", async () => {
    const factory = vi.fn<StreamFactory>(async () => makeStream([]));
    const onLine = vi.fn();
    const { unmount } = render(
      <Harness factory={factory} onLine={onLine} enabled={false} />,
    );
    await flush();
    expect(factory).not.toHaveBeenCalled();
    unmount();
  });

  it("cancels on unmount", async () => {
    let cancelled = false;
    const factory: StreamFactory = async () =>
      new ReadableStream<Uint8Array>({
        pull() {
          /* never emits */
        },
        cancel() {
          cancelled = true;
        },
      });
    const { unmount } = render(
      <Harness factory={factory} onLine={() => undefined} enabled={true} />,
    );
    await flush();
    unmount();
    await flush();
    expect(cancelled).toBe(true);
  });

  it("surfaces errors as state: error", async () => {
    const factory: StreamFactory = async () => {
      throw new Error("boom");
    };
    const { lastFrame, unmount } = render(
      <Harness factory={factory} onLine={() => undefined} enabled={true} />,
    );
    await flush();
    expect(lastFrame()).toContain("error");
    unmount();
  });
});
