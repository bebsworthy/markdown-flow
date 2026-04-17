// src/components/step-table.tsx
//
// Stateless READ-ONLY step-table pane. Composes the column header row + a
// list of <StepTableRow> entries. Does NOT own `useInput` — cursor
// navigation lands in P6-T2.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §9
//   - docs/tui/mockups.md §4 (running) + §6 (terminal)
//
// Width-as-prop: ink-testing-library does not expose a `cols` option, so
// callers pass `width` explicitly. The app-shell threads
// `useStdout().stdout.columns - 2` through.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import { computeStepColumnWidths, fitStepCell } from "../steps/columns.js";
import type { StepRow, StepTableColumn } from "../steps/types.js";
import { StepTableRow } from "./step-table-row.js";

export interface StepTableProps {
  readonly rows: ReadonlyArray<StepRow>;
  readonly columns: ReadonlyArray<StepTableColumn>;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly selectedStepId?: string | null;
  readonly cursorRowIndex?: number;
}

const DEFAULT_CURSOR_INDEX = -1;

function StepTableImpl({
  rows,
  columns,
  width,
  height,
  nowMs,
  selectedStepId,
  cursorRowIndex,
}: StepTableProps): React.ReactElement {
  void nowMs; // All row data is already formatted; nowMs is kept for future
  // ticker-driven re-derivation (P6-T0 / P6-T2) and parity with <RunsTable>.
  const theme = useTheme();
  const cursor = cursorRowIndex ?? DEFAULT_CURSOR_INDEX;

  if (width <= 0 || height <= 0) return <Box width={width} height={height} />;

  // Empty-state: hide-don't-grey — no header, just a dim "no steps yet".
  if (rows.length === 0) {
    const padRows = Math.max(0, height - 1);
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          no steps yet
        </Text>
        {Array.from({ length: padRows }, (_, idx) => (
          <Text key={`pad-${idx}`}> </Text>
        ))}
      </Box>
    );
  }

  const widths = computeStepColumnWidths(columns, width);

  // Reserve 1 row for header; overflow drops from the tail.
  const visibleRowCount = Math.max(0, height - 1);
  const visibleRows = rows.slice(0, visibleRowCount);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Box flexDirection="row">
        <Text>{"  "}</Text>
        {columns.map((col, idx) => {
          const colWidth = widths.get(col.id) ?? col.width;
          const isLast = idx === columns.length - 1;
          const text = fitStepCell(col.header, colWidth, col.align);
          return (
            <React.Fragment key={col.id}>
              <Text
                bold
                color={theme.colors.dim.color}
                dimColor={theme.colors.dim.dim === true}
              >
                {text}
              </Text>
              {isLast ? null : <Text> </Text>}
            </React.Fragment>
          );
        })}
      </Box>

      {/* Data rows */}
      {visibleRows.map((row, i) => (
        <StepTableRow
          key={row.id}
          row={row}
          columns={columns}
          selected={
            i === cursor ||
            (selectedStepId != null && row.id === selectedStepId)
          }
          width={width}
        />
      ))}
    </Box>
  );
}

export const StepTable = React.memo(StepTableImpl);
StepTable.displayName = "StepTable";
