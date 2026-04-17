// src/components/step-table-view.tsx
//
// Wrapper around <StepTable> that owns the projection of engine-slice data
// (`EngineState`) into a `StepRow[]`. Tests render <StepTable> directly
// with hand-crafted fixtures; production renders <StepTableView> which
// feeds the snapshot through.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §8
//
// This component is the test-injection seam for the engine slice — its
// subscription hooks are tiny wrappers around pure helpers so the heavy
// lifting stays in `src/steps/*`.

import React, { useMemo } from "react";
import type { EngineState } from "../engine/types.js";
import { pickStepColumnSet } from "../steps/columns.js";
import {
  buildStepRows,
  projectStepsSnapshot,
} from "../steps/tree.js";
import { buildRetryHints } from "../steps/retry.js";
import type { StepRow } from "../steps/types.js";
import { StepTable } from "./step-table.js";

export interface StepTableViewProps {
  readonly runId: string;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly selectedStepId?: string | null;
  readonly cursorRowIndex?: number;
}

const EMPTY_ROWS: ReadonlyArray<StepRow> = Object.freeze([]);

function StepTableViewImpl({
  runId,
  engineState,
  width,
  height,
  nowMs,
  selectedStepId,
  cursorRowIndex,
}: StepTableViewProps): React.ReactElement {
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
  const rows = useMemo(
    () =>
      info || (events && events.length > 0)
        ? buildStepRows(snapshot, info, nowMs, retryHints)
        : EMPTY_ROWS,
    [snapshot, info, nowMs, retryHints, events],
  );
  const columns = useMemo(() => pickStepColumnSet(width), [width]);

  return (
    <StepTable
      rows={rows}
      columns={columns}
      width={width}
      height={height}
      nowMs={nowMs}
      selectedStepId={selectedStepId}
      cursorRowIndex={cursorRowIndex}
    />
  );
}

export const StepTableView = React.memo(StepTableViewImpl);
StepTableView.displayName = "StepTableView";
