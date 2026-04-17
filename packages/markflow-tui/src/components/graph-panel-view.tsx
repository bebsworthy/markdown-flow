// src/components/graph-panel-view.tsx
//
// Owner component for the Graph tab (P6-T4). Projects the engine slice
// into `StepRow[]` with batch aggregation disabled so the tree shows every
// child token.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §3.1 / §5.4

import React, { useMemo } from "react";
import type { EngineState } from "../engine/types.js";
import { pickStepColumnSet } from "../steps/columns.js";
import { buildStepRows, projectStepsSnapshot } from "../steps/tree.js";
import { buildRetryHints } from "../steps/retry.js";
import type { StepRow } from "../steps/types.js";
import { GraphPanel } from "./graph-panel.js";

export interface GraphPanelViewProps {
  readonly runId: string;
  readonly selectedStepId: string | null;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
}

const EMPTY_ROWS: ReadonlyArray<StepRow> = Object.freeze([]);

function GraphPanelViewImpl({
  runId,
  selectedStepId,
  engineState,
  width,
  height,
  nowMs,
}: GraphPanelViewProps): React.ReactElement | null {
  const info = engineState.runs.get(runId) ?? null;
  const activeRun = engineState.activeRun;
  const events =
    activeRun && activeRun.runId === runId ? activeRun.events : null;

  const retryHints = useMemo(
    () => (events ? buildRetryHints(events) : new Map()),
    [events],
  );
  const snapshot = useMemo(
    () => projectStepsSnapshot(events ?? [], info),
    [events, info],
  );
  const rows = useMemo(() => {
    if (!info && (!events || events.length === 0)) return EMPTY_ROWS;
    return buildStepRows(snapshot, info, nowMs, retryHints, {
      collapseThreshold: Number.POSITIVE_INFINITY,
    });
  }, [snapshot, info, nowMs, retryHints, events]);

  const columns = useMemo(() => pickStepColumnSet(width), [width]);

  const shortId = runId.length > 8 ? runId.slice(0, 8) : runId;
  const workflow = info?.workflowName ?? "—";
  const selected = selectedStepId ?? "—";
  const header = `Graph · ${shortId} · ${workflow} · ${selected}`;

  return (
    <GraphPanel
      rows={rows}
      columns={columns}
      width={width}
      height={height}
      nowMs={nowMs}
      selectedStepId={selectedStepId}
      header={header}
    />
  );
}

export const GraphPanelView = React.memo(GraphPanelViewImpl);
GraphPanelView.displayName = "GraphPanelView";
