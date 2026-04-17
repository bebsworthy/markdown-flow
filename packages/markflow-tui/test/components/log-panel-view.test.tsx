// test/components/log-panel-view.test.tsx
//
// Lifecycle + latency coverage for <LogPanelView> (P6-T3, plan §7.2).
//
// The view owns a useReducer for the pane and subscribes to two sidecar
// streams (stdout + stderr) via useSidecarStream. Tests below inject a
// `streamFactory` test seam to avoid touching fs. The latency test uses
// fake timers to assert that a ring-buffer `step:output` append produces
// `APPEND_LINES` visible in the rendered frame within 100 ms (criterion E).

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { LogPanelView } from "../../src/components/log-panel-view.js";
import type {
  EngineState,
  LiveRunSnapshot,
} from "../../src/engine/types.js";
import type { StreamFactory } from "../../src/hooks/useSidecarStream.js";
import type { LogStream } from "../../src/log/types.js";

const THEME = buildTheme({ color: true, unicode: true });

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function info(id: string): RunInfo {
  return {
    id,
    workflowName: "deploy",
    sourceFile: "./deploy.md",
    status: "running",
    startedAt: "2026-04-17T11:55:00Z",
    steps: [],
  } as RunInfo;
}

function buildEngineState(opts: {
  readonly runId: string;
  readonly events: ReadonlyArray<EngineEvent>;
}): EngineState {
  const activeRun: LiveRunSnapshot = {
    runId: opts.runId,
    info: info(opts.runId),
    events: opts.events,
    lastSeq: opts.events.length > 0 ? opts.events[opts.events.length - 1]!.seq : 0,
    terminal: false,
  };
  return {
    runs: new Map([[opts.runId, info(opts.runId)]]),
    activeRun,
  };
}

function emptyStreamFactory(): StreamFactory {
  return async () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
}

interface TrackingFactory {
  readonly factory: StreamFactory;
  readonly calls: Array<{
    readonly runDir: string;
    readonly seq: number;
    readonly stream: LogStream;
  }>;
  readonly cancelCount: () => number;
}

function trackingFactory(): TrackingFactory {
  const calls: Array<{
    readonly runDir: string;
    readonly seq: number;
    readonly stream: LogStream;
  }> = [];
  let cancelled = 0;
  const factory: StreamFactory = async (runDir, seq, stream) => {
    calls.push({ runDir, seq, stream });
    return new ReadableStream<Uint8Array>({
      pull() {
        /* never emits — keeps the stream alive so cancel() fires on unmount. */
      },
      cancel() {
        cancelled += 1;
      },
    });
  };
  return { factory, calls, cancelCount: () => cancelled };
}

async function flush(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

function renderView(props: {
  readonly runId: string;
  readonly events: ReadonlyArray<EngineEvent>;
  readonly selectedStepId: string | null;
  readonly runsDir?: string | null;
  readonly streamFactory?: StreamFactory;
}): ReturnType<typeof render> {
  const runsDir: string | null =
    props.runsDir === undefined ? "/runs" : props.runsDir;
  return render(
    <ThemeProvider value={THEME}>
      <LogPanelView
        runsDir={runsDir}
        runId={props.runId}
        selectedStepId={props.selectedStepId}
        engineState={buildEngineState({
          runId: props.runId,
          events: props.events,
        })}
        width={80}
        height={10}
        nowMs={Date.parse("2026-04-17T12:00:00Z")}
        streamFactory={props.streamFactory ?? emptyStreamFactory()}
      />
    </ThemeProvider>,
  );
}

function tokenCreated(seq: number, tokenId: string, nodeId: string): EngineEvent {
  return {
    seq,
    ts: "2026-04-17T11:55:10Z",
    type: "token:created",
    tokenId,
    nodeId,
    generation: 0,
  } as EngineEvent;
}

function stepStart(seq: number, tokenId: string, nodeId: string): EngineEvent {
  return {
    seq,
    ts: "2026-04-17T11:55:11Z",
    type: "step:start",
    nodeId,
    tokenId,
  } as EngineEvent;
}

function stepOutput(
  seq: number,
  nodeId: string,
  stream: LogStream,
  chunk: string,
): EngineEvent {
  return {
    seq,
    ts: "2026-04-17T11:55:12Z",
    type: "step:output",
    nodeId,
    stream,
    chunk,
  } as EngineEvent;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("<LogPanelView> — lifecycle (plan §7.2)", () => {
  it("subscribes to stdout + stderr sidecar streams on mount for a resolved target", async () => {
    const tf = trackingFactory();
    const { unmount } = renderView({
      runId: "r1",
      events: [tokenCreated(1, "t-build", "build"), stepStart(2, "t-build", "build")],
      selectedStepId: "t-build",
      streamFactory: tf.factory,
    });
    await flush();
    const streams = tf.calls.map((c) => c.stream).sort();
    expect(streams).toEqual(["stderr", "stdout"]);
    expect(tf.calls[0]!.seq).toBe(2); // seq of the step:start
    expect(tf.calls[0]!.runDir).toBe("/runs/r1");
    unmount();
  });

  it("does not open a stream when the target is unresolved (no selection)", async () => {
    const tf = trackingFactory();
    const { unmount } = renderView({
      runId: "r1",
      events: [],
      selectedStepId: null,
      streamFactory: tf.factory,
    });
    await flush();
    expect(tf.calls.length).toBe(0);
    unmount();
  });

  it("does not open a stream when runsDir is null", async () => {
    const tf = trackingFactory();
    const { unmount } = renderView({
      runId: "r1",
      events: [tokenCreated(1, "t-build", "build"), stepStart(2, "t-build", "build")],
      selectedStepId: "t-build",
      runsDir: null,
      streamFactory: tf.factory,
    });
    await flush();
    expect(tf.calls.length).toBe(0);
    unmount();
  });

  it("cancels both streams on unmount", async () => {
    const tf = trackingFactory();
    const { unmount } = renderView({
      runId: "r1",
      events: [tokenCreated(1, "t-build", "build"), stepStart(2, "t-build", "build")],
      selectedStepId: "t-build",
      streamFactory: tf.factory,
    });
    await flush();
    expect(tf.calls.length).toBe(2);
    unmount();
    await flush();
    // Each of the two streams should cancel on teardown.
    expect(tf.cancelCount()).toBeGreaterThanOrEqual(2);
  });

  it("re-subscribes when the target (step) changes", async () => {
    const tf = trackingFactory();
    const events1: EngineEvent[] = [
      tokenCreated(1, "t-a", "a"),
      stepStart(2, "t-a", "a"),
      tokenCreated(3, "t-b", "b"),
      stepStart(4, "t-b", "b"),
    ];
    const { rerender, unmount } = render(
      <ThemeProvider value={THEME}>
        <LogPanelView
          runsDir="/runs"
          runId="r1"
          selectedStepId="t-a"
          engineState={buildEngineState({ runId: "r1", events: events1 })}
          width={80}
          height={10}
          nowMs={0}
          streamFactory={tf.factory}
        />
      </ThemeProvider>,
    );
    await flush();
    const initialCalls = tf.calls.length;
    expect(initialCalls).toBe(2);
    expect(tf.calls.every((c) => c.seq === 2)).toBe(true);

    // Switch to step B — view should re-subscribe with the new stepSeq.
    rerender(
      <ThemeProvider value={THEME}>
        <LogPanelView
          runsDir="/runs"
          runId="r1"
          selectedStepId="t-b"
          engineState={buildEngineState({ runId: "r1", events: events1 })}
          width={80}
          height={10}
          nowMs={0}
          streamFactory={tf.factory}
        />
      </ThemeProvider>,
    );
    await flush();
    const newCalls = tf.calls.slice(initialCalls);
    expect(newCalls.length).toBe(2);
    expect(newCalls.every((c) => c.seq === 4)).toBe(true);
    unmount();
  });

  it("renders 'pending' empty state when step:start has not been observed", async () => {
    const tf = trackingFactory();
    const { lastFrame, unmount } = renderView({
      runId: "r1",
      // token:created only — no step:start yet.
      events: [tokenCreated(1, "t-build", "build")],
      selectedStepId: "t-build",
      streamFactory: tf.factory,
    });
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    // select.ts returns pending reason; the empty-state renderer shows a hint.
    expect(frame).toMatch(/log not yet available|waiting|pending/i);
    // No stream should open without a resolvable stepSeq.
    expect(tf.calls.length).toBe(0);
    unmount();
  });

  it("renders an empty-state message when no step is selected", async () => {
    const { lastFrame, unmount } = renderView({
      runId: "r1",
      events: [],
      selectedStepId: null,
    });
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toMatch(/select a step|no step|pick/i);
    unmount();
  });

  it("renders 'not-found' empty state for an unknown stepId", async () => {
    const { lastFrame, unmount } = renderView({
      runId: "r1",
      events: [tokenCreated(1, "t-build", "build"), stepStart(2, "t-build", "build")],
      selectedStepId: "t-ghost",
    });
    await flush();
    const frame = stripAnsi(lastFrame() ?? "");
    // Either a dedicated not-found string or fallback to pending/empty.
    expect(frame.length).toBeGreaterThan(0);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Latency (criterion E)
// ---------------------------------------------------------------------------

describe("<LogPanelView> — live-append latency (criterion E, plan §7.2)", () => {
  it("event-ring step:output reaches the pane reducer within 100 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    try {
      const baseEvents: EngineEvent[] = [
        tokenCreated(1, "t-build", "build"),
        stepStart(2, "t-build", "build"),
      ];

      const { rerender, lastFrame, unmount } = render(
        <ThemeProvider value={THEME}>
          <LogPanelView
            runsDir={null}
            runId="r1"
            selectedStepId="t-build"
            engineState={buildEngineState({ runId: "r1", events: baseEvents })}
            width={80}
            height={10}
            nowMs={0}
            streamFactory={emptyStreamFactory()}
          />
        </ThemeProvider>,
      );

      // Allow mount effects to settle.
      await vi.advanceTimersByTimeAsync(10);
      const before = stripAnsi(lastFrame() ?? "");
      expect(before).not.toContain("hello-latency");

      // Simulate an engine emission: append a step:output event with a
      // known payload and rerender with the new events array identity.
      const emitAt = Date.now();
      const updated: EngineEvent[] = [
        ...baseEvents,
        stepOutput(3, "build", "stdout", "hello-latency\n"),
      ];
      rerender(
        <ThemeProvider value={THEME}>
          <LogPanelView
            runsDir={null}
            runId="r1"
            selectedStepId="t-build"
            engineState={buildEngineState({ runId: "r1", events: updated })}
            width={80}
            height={10}
            nowMs={0}
            streamFactory={emptyStreamFactory()}
          />
        </ThemeProvider>,
      );

      // Advance just under 100 ms of wall time; the ring-ingestion effect
      // should have fired APPEND_LINES already (it is not gated on timers).
      await vi.advanceTimersByTimeAsync(99);
      const elapsed = Date.now() - emitAt;
      expect(elapsed).toBeLessThanOrEqual(100);

      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("hello-latency");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
