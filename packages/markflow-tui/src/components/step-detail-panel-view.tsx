// src/components/step-detail-panel-view.tsx
//
// Projection wrapper that turns the engine slice + selected step id into
// a `StepDetailModel` and renders `<StepDetailPanel>` with it. Mirrors
// `<StepTableView>`'s seam pattern so components tests can stay fast.
//
// Authoritative references:
//   - docs/tui/plans/P6-T2.md §5 + §6

import React, { useMemo } from "react";
import type { EngineState } from "../engine/types.js";
import { selectStepDetail } from "../steps/detail.js";
import { projectStepsSnapshot, buildStepRows } from "../steps/tree.js";
import { buildRetryHints } from "../steps/retry.js";
import type { StepDetailModel } from "../steps/detail-types.js";
import { StepDetailPanel } from "./step-detail-panel.js";

export interface StepDetailPanelViewProps {
  readonly runId: string;
  readonly selectedStepId: string | null;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
}

function StepDetailPanelViewImpl({
  runId,
  selectedStepId,
  engineState,
  width,
  height,
  nowMs,
}: StepDetailPanelViewProps): React.ReactElement | null {
  const info = engineState.runs.get(runId) ?? null;
  const activeRun = engineState.activeRun;
  const events =
    activeRun && activeRun.runId === runId ? activeRun.events : null;

  const snapshot = useMemo(
    () => projectStepsSnapshot(events ?? [], info),
    [events, info],
  );

  const retryHints = useMemo(
    () => (events ? buildRetryHints(events) : new Map()),
    [events],
  );

  // View-layer first-row fallback (plan §4.4 D2): when no explicit selection
  // and the step table has rows, default to rows[0].id so the detail pane
  // matches mockup §1 / §4 where the top row is pre-selected.
  const fallbackRowId = useMemo<string | null>(() => {
    if (selectedStepId !== null) return null;
    if (snapshot.tokens.size === 0 && !info) return null;
    const rows = buildStepRows(snapshot, info, nowMs, retryHints);
    return rows.length > 0 ? rows[0]!.id : null;
  }, [selectedStepId, snapshot, info, nowMs, retryHints]);

  const effectiveSelection = selectedStepId ?? fallbackRowId;

  const model: StepDetailModel = useMemo(
    () =>
      selectStepDetail(
        snapshot,
        info,
        events ?? [],
        effectiveSelection ? { rowId: effectiveSelection } : null,
        nowMs,
      ),
    [snapshot, info, events, effectiveSelection, nowMs],
  );

  return <StepDetailPanel model={model} width={width} height={height} />;
}

export const StepDetailPanelView = React.memo(StepDetailPanelViewImpl);
StepDetailPanelView.displayName = "StepDetailPanelView";
