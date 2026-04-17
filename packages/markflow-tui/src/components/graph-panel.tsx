// src/components/graph-panel.tsx
//
// Stateless full-size graph renderer (P6-T4). Thin wrapper around
// <StepTable> — the Graph tab reuses the same `StepRow[]` projection but
// frames it with a graph header.
//
// Authoritative references:
//   - docs/tui/mockups.md §1 tab group
//   - docs/tui/plans/P6-T4.md §1

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { StepRow, StepTableColumn } from "../steps/types.js";
import { StepTable } from "./step-table.js";

export interface GraphPanelProps {
  readonly rows: ReadonlyArray<StepRow>;
  readonly columns: ReadonlyArray<StepTableColumn>;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly selectedStepId?: string | null;
  readonly cursorRowIndex?: number;
  /** Header text rendered above the tree rows. */
  readonly header: string;
}

function GraphPanelImpl({
  rows,
  columns,
  width,
  height,
  nowMs,
  selectedStepId,
  cursorRowIndex,
  header,
}: GraphPanelProps): React.ReactElement | null {
  const theme = useTheme();
  if (width <= 0 || height <= 0) return null;

  // Empty state: dim "no graph yet" message.
  if (rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          no graph yet — waiting for run to start
        </Text>
        {Array.from({ length: Math.max(0, height - 1) }, (_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
      </Box>
    );
  }

  // 1 row is reserved for the graph header; the step table reserves one
  // additional row for its own column header.
  const innerHeight = Math.max(0, height - 1);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={theme.colors.accent.color}
        dimColor={theme.colors.accent.dim === true}
      >
        {header}
      </Text>
      <StepTable
        rows={rows}
        columns={columns}
        width={width}
        height={innerHeight}
        nowMs={nowMs}
        selectedStepId={selectedStepId}
        cursorRowIndex={cursorRowIndex}
      />
    </Box>
  );
}

export const GraphPanel = React.memo(GraphPanelImpl);
GraphPanel.displayName = "GraphPanel";
