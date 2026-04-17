// src/components/step-table-row.tsx
//
// Single-row renderer for the step table. Kept separate from the table so
// snapshot tests can target it in isolation (plan §1 file list).
//
// All layout decisions (width/grow) come from `computeStepColumnWidths`.
// This file maps each column cell into a styled `<Text>` node and resolves
// theme glyphs (status, progress bar) at render time.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §9.4 + §9.7
//   - docs/tui/mockups.md §4 (running aggregate row) + §6 (terminal)

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import {
  computeStepColumnWidths,
  fitStepCell,
} from "../steps/columns.js";
import {
  DEFAULT_PROGRESS_BAR_WIDTH,
  formatProgressBar,
} from "../steps/aggregate.js";
import type { StepRow, StepTableColumn } from "../steps/types.js";

export interface StepTableRowProps {
  readonly row: StepRow;
  readonly columns: ReadonlyArray<StepTableColumn>;
  readonly selected: boolean;
  readonly width: number;
}

const CURSOR_SELECTED = "\u25b6 "; // "▶ "
const CURSOR_UNSELECTED = "  ";

function StepTableRowImpl({
  row,
  columns,
  selected,
  width,
}: StepTableRowProps): React.ReactElement {
  const theme = useTheme();
  const widths = computeStepColumnWidths(columns, width);

  return (
    <Box flexDirection="row">
      <Text>{selected ? CURSOR_SELECTED : CURSOR_UNSELECTED}</Text>
      {columns.map((col, idx) => {
        const colWidth = widths.get(col.id) ?? col.width;
        const isLast = idx === columns.length - 1;

        if (col.id === "status" && col.projectStatus) {
          const cell = col.projectStatus(row);
          const themeGlyph = theme.glyphs[cell.glyphKey];
          const spec = theme.colors[cell.role];
          const visible = `${themeGlyph} ${cell.label}`;
          const fitted = fitStepCell(visible, colWidth, col.align);
          const trimLen =
            visible.length <= colWidth ? visible.length : colWidth;
          const colored = fitted.slice(0, trimLen);
          const trailing = fitted.slice(trimLen);
          return (
            <React.Fragment key={col.id}>
              <Text color={spec.color} dimColor={spec.dim === true}>
                {colored}
              </Text>
              {trailing.length > 0 ? <Text>{trailing}</Text> : null}
              {isLast ? null : <Text> </Text>}
            </React.Fragment>
          );
        }

        // NOTE column on aggregate rows: build the composite text from
        // theme-resolved progress-bar glyphs so ASCII terminals fall back
        // to `#` / `.` automatically.
        if (
          col.id === "note" &&
          row.kind === "batch-aggregate" &&
          row.aggregate
        ) {
          const bar = formatProgressBar(
            row.aggregate.completed,
            row.aggregate.expected,
            DEFAULT_PROGRESS_BAR_WIDTH,
            theme.glyphs.progressFilled,
            theme.glyphs.progressEmpty,
          );
          const count = `${row.aggregate.completed} / ${row.aggregate.expected}`;
          let suffix: string;
          if (row.aggregate.status === "running") {
            const word = row.aggregate.retries === 1 ? "retry" : "retries";
            suffix = `${row.aggregate.retries} ${word} \u00b7 ${row.aggregate.failed} failed`;
          } else if (row.aggregate.status === "failed") {
            suffix = `${row.aggregate.failed} ${theme.glyphs.fail} \u00b7 0 ${theme.glyphs.waiting}`;
          } else {
            suffix = "";
          }
          const composite =
            suffix.length === 0
              ? `${count}   ${bar}`
              : `${count}   ${bar}   ${suffix}`;
          const fitted = fitStepCell(composite, colWidth, col.align);
          return (
            <React.Fragment key={col.id}>
              <Text>{fitted}</Text>
              {isLast ? null : <Text> </Text>}
            </React.Fragment>
          );
        }

        // STEP column on aggregate rows: swap the `⟳` glyph prefix with
        // the theme-resolved glyph.
        if (col.id === "step" && row.kind === "batch-aggregate") {
          const indent = "  ".repeat(Math.max(0, row.depth));
          const label = `${theme.glyphs.batch} batch [${row.nodeId}]`;
          const text = fitStepCell(`${indent}${label}`, colWidth, col.align);
          return (
            <React.Fragment key={col.id}>
              <Text>{text}</Text>
              {isLast ? null : <Text> </Text>}
            </React.Fragment>
          );
        }

        const text = fitStepCell(col.projectText(row, widths), colWidth, col.align);
        return (
          <React.Fragment key={col.id}>
            <Text>{text}</Text>
            {isLast ? null : <Text> </Text>}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

export const StepTableRow = React.memo(StepTableRowImpl);
StepTableRow.displayName = "StepTableRow";
