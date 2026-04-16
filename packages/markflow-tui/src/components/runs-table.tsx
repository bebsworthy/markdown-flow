// src/components/runs-table.tsx
//
// Stateless runs-table pane. Composes the column header row + one
// `<RunsTableRow>` per row. Owns exactly one key binding: `s` cycles the
// sort key via `RUNS_SORT_CYCLE`. Cursor movement (↑/↓/⏎) is deferred to
// P5-T3, which wires the table into `app.tsx`.
//
// Authoritative references:
//   - docs/tui/features.md §3.2
//   - docs/tui/mockups.md §1 (top half)
//   - docs/tui/plans/P5-T1.md §6, §8
//
// Width-as-prop: ink-testing-library does not expose a `cols` option, so
// callers pass `width` explicitly. The app-shell threads
// `useStdout().stdout.columns` through (wired in P5-T3).

import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import type { RunsSortState, RunsTableRow as RowData } from "../runs/types.js";
import { pickColumnSet, computeColumnWidths, fitCell } from "../runs/columns.js";
import { sortRows } from "../runs/sort.js";
import { RunsTableRow } from "./runs-table-row.js";
import type { Action } from "../state/types.js";

export interface RunsTableProps {
  readonly rows: ReadonlyArray<RowData>;
  readonly sort: RunsSortState;
  readonly selectedRunId: string | null;
  readonly width: number;
  readonly height?: number;
  readonly dispatch: (action: Action) => void;
  /**
   * Disable the `s` key binding. Tests set this so a sibling keybar
   * fixture can own routing, and so snapshot tests don't race.
   */
  readonly inputDisabled?: boolean;
}

const DEFAULT_HEIGHT = 10;

function RunsTableImpl({
  rows,
  sort,
  selectedRunId,
  width,
  height,
  dispatch,
  inputDisabled,
}: RunsTableProps): React.ReactElement {
  const theme = useTheme();
  const paneHeight = height ?? DEFAULT_HEIGHT;

  // Key routing — only `s` cycles sort. P5-T3 adds cursor + ⏎.
  useInput(
    (input, _key) => {
      if (input === "s") {
        dispatch({ type: "RUNS_SORT_CYCLE" });
        return;
      }
    },
    { isActive: !inputDisabled },
  );

  // Empty state (hide-don't-grey — no header, no chrome).
  if (rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={paneHeight}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          no runs yet
        </Text>
      </Box>
    );
  }

  const columns = pickColumnSet(width);
  const widths = computeColumnWidths(columns, width);
  const sorted = sortRows(rows, sort);

  return (
    <Box flexDirection="column" width={width} height={paneHeight}>
      {/* Header row */}
      <Box flexDirection="row">
        <Text>{"  "}</Text>
        {columns.map((col, idx) => {
          const colWidth = widths[idx] ?? col.width;
          const isLast = idx === columns.length - 1;
          const text = fitCell(col.header, colWidth, col.align);
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
      {sorted.map((row) => (
        <RunsTableRow
          key={row.id}
          row={row}
          columns={columns}
          selected={row.id === selectedRunId}
          width={width}
        />
      ))}
    </Box>
  );
}

export const RunsTable = React.memo(RunsTableImpl);
RunsTable.displayName = "RunsTable";
