// src/components/runs-table.tsx
//
// Stateless runs-table pane. Composes:
//   - optional `<RunsFilterBar>` when `runsFilter.open === true`
//   - column header row
//   - windowed slice of `<RunsTableRow>` per row (virtualised)
//   - `<RunsFooter>` showing N shown / M archived / a Show all
//
// Owns three key bindings:
//   s  → RUNS_SORT_CYCLE     (suppressed while filter bar is open)
//   /  → RUNS_FILTER_OPEN    (suppressed while filter bar is open)
//   a  → RUNS_ARCHIVE_TOGGLE (suppressed while filter bar is open)
//
// Cursor movement (↑/↓/⏎) is still P5-T3; cursor is a prop defaulting to 0.
//
// Authoritative references:
//   - docs/tui/features.md §3.2
//   - docs/tui/mockups.md §1 (top half)
//   - docs/tui/plans/P5-T2.md §7, §8
//
// Width-as-prop: ink-testing-library does not expose a `cols` option, so
// callers pass `width` explicitly. The app-shell threads
// `useStdout().stdout.columns` through (wired in P5-T3).

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import type {
  RunsArchivePolicy,
  RunsFilterState,
  RunsSortState,
  RunsTableRow as RowData,
} from "../runs/types.js";
import { pickColumnSet, computeColumnWidths, fitCell } from "../runs/columns.js";
import { sortRows } from "../runs/sort.js";
import { applyArchive, applyFilter } from "../runs/filter.js";
import {
  computeWindow,
  deriveVisibleRows,
  sliceWindow,
} from "../runs/window.js";
import { RunsTableRow } from "./runs-table-row.js";
import { RunsFilterBar } from "./runs-filter-bar.js";
import { RunsFooter } from "./runs-footer.js";
import type { Action } from "../state/types.js";

export interface RunsTableProps {
  readonly rows: ReadonlyArray<RowData>;
  readonly sort: RunsSortState;
  readonly runsFilter: RunsFilterState;
  readonly runsArchive: RunsArchivePolicy;
  readonly selectedRunId: string | null;
  readonly cursor?: number;
  readonly width: number;
  readonly height?: number;
  readonly nowMs: number;
  readonly dispatch: (action: Action) => void;
  /**
   * Disable ALL key bindings owned by this component (s, /, a). Tests
   * set this so a sibling keybar fixture can own routing, and so
   * snapshot tests don't race.
   */
  readonly inputDisabled?: boolean;
  /**
   * Test hook — injected mock of `applyFilter` so memoisation tests can
   * observe call counts. Production callers omit this.
   */
  readonly applyFilterImpl?: typeof applyFilter;
}

const DEFAULT_HEIGHT = 10;
const HEADER_ROWS = 1;
const FILTER_BAR_ROWS = 2; // input line + parsed-terms line
const FOOTER_ROWS = 1;

function RunsTableImpl({
  rows,
  sort,
  runsFilter,
  runsArchive,
  selectedRunId,
  cursor,
  width,
  height,
  nowMs,
  dispatch,
  inputDisabled,
  applyFilterImpl,
}: RunsTableProps): React.ReactElement {
  const theme = useTheme();
  const paneHeight = height ?? DEFAULT_HEIGHT;
  const cursorIndex = cursor ?? 0;

  const [viewportOffset, setViewportOffset] = useState<number>(0);

  // Key routing — s / / / a. Suppressed while the filter bar is open so
  // the bar owns keystrokes (plan §5.3). Also suppressed by the
  // `inputDisabled` prop — preserves the P5-T1 test precedent.
  useInput(
    (input, _key) => {
      if (input === "s") {
        dispatch({ type: "RUNS_SORT_CYCLE" });
        return;
      }
      if (input === "/") {
        dispatch({ type: "RUNS_FILTER_OPEN" });
        return;
      }
      if (input === "a") {
        dispatch({ type: "RUNS_ARCHIVE_TOGGLE" });
        return;
      }
    },
    { isActive: !inputDisabled && !runsFilter.open },
  );

  // ---------------------------------------------------------------------
  // Filter → archive → sort pipeline (memoised)
  // ---------------------------------------------------------------------
  const filteredRows = useMemo(
    () => (applyFilterImpl ?? applyFilter)(rows, runsFilter.applied, nowMs),
    [rows, runsFilter.applied, nowMs, applyFilterImpl],
  );
  const { shown: archiveShown, archived: archivedRows } = useMemo(
    () => applyArchive(filteredRows, runsArchive, nowMs),
    [filteredRows, runsArchive, nowMs],
  );
  const sortedRows = useMemo(
    () => sortRows(archiveShown, sort),
    [archiveShown, sort],
  );

  // ---------------------------------------------------------------------
  // Window math
  // ---------------------------------------------------------------------
  const headerOverhead =
    HEADER_ROWS + (runsFilter.open ? FILTER_BAR_ROWS : 0) + FOOTER_ROWS;
  const visibleRows = deriveVisibleRows(paneHeight, headerOverhead, 0);

  const windowState = useMemo(
    () =>
      computeWindow({
        rowCount: sortedRows.length,
        cursor: cursorIndex,
        offset: viewportOffset,
        visibleRows,
      }),
    [sortedRows.length, cursorIndex, viewportOffset, visibleRows],
  );

  // Keep local offset in sync with computed offset (runs on scroll).
  useEffect(() => {
    if (windowState.offset !== viewportOffset) {
      setViewportOffset(windowState.offset);
    }
  }, [windowState.offset, viewportOffset]);

  // Reset viewport on major input changes (filter apply, archive toggle).
  useEffect(() => {
    setViewportOffset(0);
  }, [runsFilter.applied, runsArchive.shown]);

  const windowSlice = useMemo(
    () => sliceWindow(sortedRows, windowState),
    [sortedRows, windowState.offset, windowState.visibleRows],
  );

  const columns = pickColumnSet(width);
  const widths = computeColumnWidths(columns, width);

  // Empty state branches — distinguish "no runs yet" from "filter matched none".
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

  const filterHasTerms = runsFilter.applied.terms.some(
    (t) => t.kind !== "malformed",
  );
  const archiveActive = !runsArchive.shown && archivedRows.length > 0;
  const zeroVisible = sortedRows.length === 0;

  return (
    <Box flexDirection="column" width={width} height={paneHeight}>
      {runsFilter.open ? (
        <RunsFilterBar
          filter={runsFilter}
          dispatch={dispatch}
          width={width}
          inputDisabled={inputDisabled}
        />
      ) : null}

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

      {/* Data rows — only the current window is mounted. */}
      {zeroVisible ? (
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {filterHasTerms || archiveActive
            ? "no runs match"
            : "no runs yet"}
        </Text>
      ) : (
        windowSlice.map((row) => (
          <RunsTableRow
            key={row.id}
            row={row}
            columns={columns}
            selected={row.id === selectedRunId}
            width={width}
          />
        ))
      )}

      {/* Footer — live counts */}
      <RunsFooter
        shown={archiveShown.length}
        archived={archivedRows.length}
        archiveShown={runsArchive.shown}
        width={width}
      />
    </Box>
  );
}

export const RunsTable = React.memo(RunsTableImpl);
RunsTable.displayName = "RunsTable";
