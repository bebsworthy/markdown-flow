// src/components/viewing-panes.tsx
//
// Bottom-slot host for RUN mode (P6-T4). Keeps all non-graph panes mounted
// simultaneously, toggling visibility via height=0 wrappers so pane-local
// reducer state (log follow/paused, events filter/cursor) survives tab
// switches.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §5

import React from "react";
import { Box } from "ink";
import type { EngineState } from "../engine/types.js";
import type { ViewingFocus } from "../state/types.js";
import { StepDetailPanelView } from "./step-detail-panel-view.js";
import { LogPanelView } from "./log-panel-view.js";
import { EventsPanelView } from "./events-panel-view.js";
import type { StreamFactory } from "../hooks/useSidecarStream.js";
import type { EngineEvent } from "markflow";

export interface ViewingBottomSlotProps {
  readonly focus: ViewingFocus;
  readonly runsDir: string | null;
  readonly runId: string;
  readonly selectedStepId: string | null;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly streamFactory?: StreamFactory;
  readonly eventLogReader?: (
    runDir: string,
  ) => Promise<ReadonlyArray<EngineEvent>>;
}

interface PaneVisibilityProps {
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
  readonly children: React.ReactNode;
}

function PaneVisibility({
  visible,
  width,
  height,
  children,
}: PaneVisibilityProps): React.ReactElement {
  return (
    <Box
      width={width}
      height={visible ? height : 0}
      overflow="hidden"
      flexDirection="column"
    >
      {children}
    </Box>
  );
}

function ViewingBottomSlotImpl(
  props: ViewingBottomSlotProps,
): React.ReactElement {
  const {
    focus,
    runsDir,
    runId,
    selectedStepId,
    engineState,
    width,
    height,
    nowMs,
    streamFactory,
    eventLogReader,
  } = props;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <PaneVisibility
        visible={focus === "detail"}
        width={width}
        height={height}
      >
        <StepDetailPanelView
          runId={runId}
          selectedStepId={selectedStepId}
          engineState={engineState}
          width={width}
          height={focus === "detail" ? height : 0}
          nowMs={nowMs}
        />
      </PaneVisibility>
      <PaneVisibility
        visible={focus === "log"}
        width={width}
        height={height}
      >
        <LogPanelView
          runsDir={runsDir}
          runId={runId}
          selectedStepId={selectedStepId}
          engineState={engineState}
          width={width}
          height={focus === "log" ? height : 0}
          nowMs={nowMs}
          streamFactory={streamFactory}
          active={focus === "log"}
        />
      </PaneVisibility>
      <PaneVisibility
        visible={focus === "events"}
        width={width}
        height={height}
      >
        <EventsPanelView
          runsDir={runsDir}
          runId={runId}
          engineState={engineState}
          width={width}
          height={focus === "events" ? height : 0}
          nowMs={nowMs}
          active={focus === "events"}
          eventLogReader={eventLogReader}
        />
      </PaneVisibility>
    </Box>
  );
}

export const ViewingBottomSlot = React.memo(ViewingBottomSlotImpl);
ViewingBottomSlot.displayName = "ViewingBottomSlot";
