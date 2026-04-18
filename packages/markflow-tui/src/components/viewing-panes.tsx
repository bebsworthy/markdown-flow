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
import { Box, Text } from "ink";
import type { EngineState } from "../engine/types.js";
import type { ViewingFocus } from "../state/types.js";
import { StepDetailPanelView } from "./step-detail-panel-view.js";
import { LogPanelView } from "./log-panel-view.js";
import { EventsPanelView } from "./events-panel-view.js";
import type { StreamFactory } from "../hooks/useSidecarStream.js";
import type { EngineEvent } from "markflow";
import {
  composeViewingTabRow,
  type ViewingTabKey,
} from "./viewing-pane-tabs-layout.js";

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
  /**
   * Optional right-side suffix text for the tab-header row (e.g.
   * "abcd12 · deploy · build · seq=142"). Dropped at narrow tier by
   * `composeViewingTabRow`.
   */
  readonly tabSuffix?: string;
}

function TabHeader({
  focus,
  width,
  suffix,
}: {
  readonly focus: ViewingFocus;
  readonly width: number;
  readonly suffix?: string;
}): React.ReactElement {
  // ViewingFocus is a sum of the same four keys as ViewingTabKey.
  const row = composeViewingTabRow(focus as ViewingTabKey, width, suffix);
  return (
    <Box flexDirection="row" justifyContent="space-between" width={width}>
      <Box flexDirection="row">
        {row.tokens.map((tok, i) => {
          const sep = i > 0 ? "  " : "";
          return (
            <React.Fragment key={`tab-${i}`}>
              {sep ? <Text>{sep}</Text> : null}
              {tok.active ? (
                <Text inverse bold>
                  {tok.text}
                </Text>
              ) : (
                <Text>{tok.text}</Text>
              )}
            </React.Fragment>
          );
        })}
      </Box>
      {row.suffix !== null ? <Text>{row.suffix}</Text> : null}
    </Box>
  );
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
      height={height}
      display={visible ? "flex" : "none"}
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
    tabSuffix,
  } = props;

  // Tab header consumes 1 row; inner pane height is reduced accordingly.
  const headerRows = height > 0 ? 1 : 0;
  const paneHeight = Math.max(0, height - headerRows);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {headerRows > 0 ? (
        <TabHeader focus={focus} width={width} suffix={tabSuffix} />
      ) : null}
      <PaneVisibility
        visible={focus === "detail"}
        width={width}
        height={paneHeight}
      >
        <StepDetailPanelView
          runId={runId}
          selectedStepId={selectedStepId}
          engineState={engineState}
          width={width}
          height={paneHeight}
          nowMs={nowMs}
        />
      </PaneVisibility>
      <PaneVisibility
        visible={focus === "log"}
        width={width}
        height={paneHeight}
      >
        <LogPanelView
          runsDir={runsDir}
          runId={runId}
          selectedStepId={selectedStepId}
          engineState={engineState}
          width={width}
          height={paneHeight}
          nowMs={nowMs}
          streamFactory={streamFactory}
          active={focus === "log"}
        />
      </PaneVisibility>
      <PaneVisibility
        visible={focus === "events"}
        width={width}
        height={paneHeight}
      >
        <EventsPanelView
          runsDir={runsDir}
          runId={runId}
          engineState={engineState}
          width={width}
          height={paneHeight}
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
