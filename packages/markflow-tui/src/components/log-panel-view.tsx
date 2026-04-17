// src/components/log-panel-view.tsx
//
// Owner component for the log pane (P6-T3). Holds the `logReducer` state,
// resolves the log target, opens a sidecar stream, subscribes to the
// engine event ring, and handles keybindings.
//
// Authoritative references:
//   - docs/tui/plans/P6-T3.md §5 / §6

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useInput } from "ink";
import type { EngineState } from "../engine/types.js";
import {
  appendEventLines,
  deriveLogModel,
  initialLogPanelState,
  logReducer,
  parseSidecarText,
  resolveLogTarget,
} from "../log/index.js";
import type {
  LogLine,
  LogPanelState,
  LogReducerAction,
  LogStream,
} from "../log/types.js";
import { projectStepsSnapshot } from "../steps/tree.js";
import { LogPanel } from "./log-panel.js";
import type { StreamFactory } from "../hooks/useSidecarStream.js";
import { useSidecarStream } from "../hooks/useSidecarStream.js";

export interface LogPanelViewProps {
  readonly runsDir: string | null;
  readonly runId: string;
  readonly selectedStepId: string | null;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  /** Test seam — overrides `getSidecarStream`. */
  readonly streamFactory?: StreamFactory;
}

// ---------------------------------------------------------------------------
// LogPaneStatusContext — surfaces follow/paused state to the keybar.
// ---------------------------------------------------------------------------

export interface LogPaneStatus {
  readonly isFollowing: boolean;
  readonly isWrapped: boolean;
  readonly isMounted: boolean;
}

const DEFAULT_STATUS: LogPaneStatus = {
  isFollowing: false,
  isWrapped: false,
  isMounted: false,
};

export const LogPaneStatusContext =
  createContext<LogPaneStatus>(DEFAULT_STATUS);

export function useLogPaneStatus(): LogPaneStatus {
  return useContext(LogPaneStatusContext);
}

// ---------------------------------------------------------------------------
// LogPanelView
// ---------------------------------------------------------------------------

function LogPanelViewImpl({
  runsDir,
  runId,
  selectedStepId,
  engineState,
  width,
  height,
  streamFactory,
}: LogPanelViewProps): React.ReactElement {
  const [logState, dispatch] = useReducer(logReducer, initialLogPanelState);

  const info = engineState.runs.get(runId) ?? null;
  const activeRun = engineState.activeRun;
  const events =
    activeRun && activeRun.runId === runId ? activeRun.events : null;

  const snapshot = useMemo(
    () => projectStepsSnapshot(events ?? [], info),
    [events, info],
  );

  const resolved = useMemo(
    () =>
      resolveLogTarget(
        snapshot,
        events ?? [],
        selectedStepId ? { rowId: selectedStepId } : null,
      ),
    [snapshot, events, selectedStepId],
  );

  // --- Target identity -----------------------------------------------------
  // Cached target triple so effect deps stay shallow across re-renders.
  const targetKey = resolved.exists
    ? `${runId}:${resolved.stepSeq}:${resolved.nodeId}`
    : null;
  const lastTargetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (targetKey !== lastTargetKeyRef.current) {
      lastTargetKeyRef.current = targetKey;
      dispatch({ type: "RESET" });
    }
  }, [targetKey]);

  // --- Event-ring ingestion -----------------------------------------------
  const ringBaseRef = useRef<number>(0);
  const countersRef = useRef<Record<LogStream, number>>({ stdout: 0, stderr: 0 });
  const partialRef = useRef<Record<LogStream, string>>({ stdout: "", stderr: "" });

  useEffect(() => {
    if (!resolved.exists || events === null) return;
    const tail = events.slice(ringBaseRef.current);
    if (tail.length === 0) return;
    ringBaseRef.current = events.length;
    const res = appendEventLines(
      tail,
      { stepSeq: resolved.stepSeq, nodeId: resolved.nodeId },
      partialRef.current,
      countersRef.current,
    );
    partialRef.current = { ...res.partialByStream };
    countersRef.current = { ...res.nextCounts };
    if (res.lines.length > 0) {
      dispatch({ type: "APPEND_LINES", lines: res.lines });
    }
  }, [events, resolved]);

  // Reset ring pointer + counters on target change.
  useEffect(() => {
    ringBaseRef.current = 0;
    countersRef.current = { stdout: 0, stderr: 0 };
    partialRef.current = { stdout: "", stderr: "" };
  }, [targetKey]);

  // --- Sidecar stream ingestion -------------------------------------------
  const runDir =
    resolved.exists && runsDir !== null ? `${runsDir}/${runId}` : null;

  const onStdoutLine = (line: string): void => {
    if (!resolved.exists) return;
    const target = { stepSeq: resolved.stepSeq, nodeId: resolved.nodeId };
    const base = countersRef.current.stdout;
    const lines: LogLine[] = parseSidecarText(
      line + "\n",
      target,
      "stdout",
      base,
    );
    if (lines.length > 0) {
      countersRef.current = {
        ...countersRef.current,
        stdout: base + lines.length,
      };
      dispatch({ type: "APPEND_LINES", lines });
    }
  };
  const onStderrLine = (line: string): void => {
    if (!resolved.exists) return;
    const target = { stepSeq: resolved.stepSeq, nodeId: resolved.nodeId };
    const base = countersRef.current.stderr;
    const lines: LogLine[] = parseSidecarText(
      line + "\n",
      target,
      "stderr",
      base,
    );
    if (lines.length > 0) {
      countersRef.current = {
        ...countersRef.current,
        stderr: base + lines.length,
      };
      dispatch({ type: "APPEND_LINES", lines });
    }
  };

  useSidecarStream({
    runDir,
    stepSeq: resolved.exists ? resolved.stepSeq : null,
    nodeId: resolved.exists ? resolved.nodeId : null,
    stream: "stdout",
    enabled: resolved.exists && runDir !== null,
    onLine: onStdoutLine,
    streamFactory,
  });
  useSidecarStream({
    runDir,
    stepSeq: resolved.exists ? resolved.stepSeq : null,
    nodeId: resolved.exists ? resolved.nodeId : null,
    stream: "stderr",
    enabled: resolved.exists && runDir !== null,
    onLine: onStderrLine,
    streamFactory,
  });

  // --- Keybindings --------------------------------------------------------
  useInput((input, key) => {
    const act = keyToAction(input, key, logState);
    if (act) dispatch(act);
  });

  // --- Model + render ------------------------------------------------------
  const model = useMemo(
    () =>
      deriveLogModel({
        state: logState,
        viewport: { width, height },
        target: resolved.exists
          ? { nodeId: resolved.nodeId, stepSeq: resolved.stepSeq }
          : null,
        empty: resolved.exists ? null : resolved.reason,
      }),
    [logState, width, height, resolved],
  );

  const status: LogPaneStatus = {
    isFollowing: logState.follow,
    isWrapped: logState.settings.wrap,
    isMounted: true,
  };

  return (
    <LogPaneStatusContext.Provider value={status}>
      <LogPanel model={model} width={width} height={height} />
    </LogPaneStatusContext.Provider>
  );
}

function keyToAction(
  input: string,
  key: {
    readonly upArrow?: boolean;
    readonly downArrow?: boolean;
    readonly pageUp?: boolean;
    readonly pageDown?: boolean;
    readonly return?: boolean;
    readonly escape?: boolean;
  },
  state: LogPanelState,
): LogReducerAction | null {
  if (key.upArrow) return { type: "SCROLL_DELTA", delta: -1 };
  if (key.downArrow) return { type: "SCROLL_DELTA", delta: 1 };
  if (key.pageUp) return { type: "SCROLL_PAGE", direction: "up", pageSize: 10 };
  if (key.pageDown) return { type: "SCROLL_PAGE", direction: "down", pageSize: 10 };
  if (input === "f") return { type: "SET_FOLLOW", follow: !state.follow };
  if (input === "F") return { type: "SCROLL_JUMP_HEAD" };
  if (input === "G") return { type: "SCROLL_JUMP_HEAD" };
  if (input === "g") return { type: "SCROLL_JUMP_TOP" };
  if (input === "w") return { type: "SET_WRAP", wrap: !state.settings.wrap };
  if (input === "t")
    return { type: "SET_TIMESTAMPS", timestamps: !state.settings.timestamps };
  if (input === "1") return { type: "SET_STREAM_FILTER", filter: "stdout" };
  if (input === "2") return { type: "SET_STREAM_FILTER", filter: "stderr" };
  if (input === "3") return { type: "SET_STREAM_FILTER", filter: "both" };
  return null;
}

export const LogPanelView = React.memo(LogPanelViewImpl);
LogPanelView.displayName = "LogPanelView";
