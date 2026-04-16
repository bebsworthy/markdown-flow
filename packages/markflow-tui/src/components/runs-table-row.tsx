// src/components/runs-table-row.tsx
//
// Single-row renderer for the runs table. Kept separate from the table so
// snapshot tests can target it in isolation (plan §1 file list).
//
// All layout decisions (width/grow) come from `computeColumnWidths`; this
// file just maps each column cell into a styled `<Text>` node. The status
// cell carries a theme-role string; the Ink layer resolves it to a color
// via `useTheme()` so the pure column module stays theme-agnostic.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type {
  RunsTableColumn,
  RunsTableRow as RunsTableRowData,
} from "../runs/types.js";
import { computeColumnWidths, fitCell } from "../runs/columns.js";

export interface RunsTableRowProps {
  readonly row: RunsTableRowData;
  readonly columns: ReadonlyArray<RunsTableColumn>;
  readonly selected: boolean;
  readonly width: number;
}

const CURSOR_SELECTED = "▶ ";
const CURSOR_UNSELECTED = "  ";

function RunsTableRowImpl({
  row,
  columns,
  selected,
  width,
}: RunsTableRowProps): React.ReactElement {
  const theme = useTheme();
  const widths = computeColumnWidths(columns, width);

  return (
    <Box flexDirection="row">
      <Text>{selected ? CURSOR_SELECTED : CURSOR_UNSELECTED}</Text>
      {columns.map((col, idx) => {
        const colWidth = widths[idx] ?? col.width;
        const isLast = idx === columns.length - 1;

        if (col.id === "status" && col.projectStatus) {
          const cell = col.projectStatus(row);
          const themeGlyph = theme.glyphs[cell.glyphKey];
          const spec = theme.colors[cell.role];
          const visible = `${themeGlyph} ${cell.label}`;
          const fitted = fitCell(visible, colWidth, col.align);
          // Split the fitted string into the colored prefix (glyph+label)
          // and the trailing padding — the padding should not carry color.
          const trimLen = visible.length <= colWidth ? visible.length : colWidth;
          const colored = fitted.slice(0, trimLen);
          const trailing = fitted.slice(trimLen);
          return (
            <React.Fragment key={col.id}>
              <Text
                color={spec.color}
                dimColor={spec.dim === true}
              >
                {colored}
              </Text>
              {trailing.length > 0 ? <Text>{trailing}</Text> : null}
              {isLast ? null : <Text> </Text>}
            </React.Fragment>
          );
        }

        const text = fitCell(col.projectText(row), colWidth, col.align);
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

export const RunsTableRow = React.memo(RunsTableRowImpl);
RunsTableRow.displayName = "RunsTableRow";
