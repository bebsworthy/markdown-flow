// src/components/runs-table.tsx
//
// Stateless runs-table pane. Composes:
//   - optional `<RunsFilterBar>` when `runsFilter.open === true`
//   - column header row
//   - windowed slice of `<RunsTableRow>` per row (virtualised)
//   - `<RunsFooter>` showing N shown / M archived / a Show all
//
// Owns key bindings:
//   s          → RUNS_SORT_CYCLE
//   /          → RUNS_FILTER_OPEN
//   a          → RUNS_ARCHIVE_TOGGLE
//   ↑ / k      → RUNS_CURSOR_MOVE(-1)
//   ↓ / j      → RUNS_CURSOR_MOVE(+1)
//   PgUp       → RUNS_CURSOR_PAGE(up, pageSize, rowCount)
//   PgDn       → RUNS_CURSOR_PAGE(down, pageSize, rowCount)
//   Home / g   → RUNS_CURSOR_HOME
//   End / G    → RUNS_CURSOR_END(rowCount)
//   Enter      → MODE_OPEN_RUN(rows[cursor].id)
// All suppressed while the filter bar is open (the bar owns keys then)
// or while `inputDisabled` is set.
//
// Authoritative references:
//   - docs/tui/features.md §3.2
//   - docs/tui/mockups.md §1 (top half)
//   - docs/tui/plans/P5-T2.md §7, §8
//   - docs/tui/plans/P5-T3.md §6 (cursor keybindings + gating)
//
// Width-as-prop: ink-testing-library does not expose a `cols` option, so
// callers pass `width` explicitly. The app-shell threads
// `useStdout().stdout.columns` through.

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
import { reconcileCursorAfterRowsChange } from "../runs/cursor.js";
import { RunsTableRow } from "./runs-table-row.js";
import { RunsFilterBar } from "./runs-filter-bar.js";
import { RunsFooter } from "./runs-footer.js";
import type { Action } from "../state/types.js";
import type { RunInfo } from "markflow";

export interface RunsTableProps {
  readonly rows: ReadonlyArray<RowData>;
  readonly sort: RunsSortState;
  readonly runsFilter: RunsFilterState;
  readonly runsArchive: RunsArchivePolicy;
  readonly selectedRunId: string | null;
  /**
   * Index into the sorted-filtered-archived row list. Threaded from
   * `state.runsCursor`. Required as of P5-T3 — callers may pass `0` when
   * they don't care, but they MUST pass something so cursor math stays
   * deterministic.
   */
  readonly cursor: number;
  readonly width: number;
  readonly height?: number;
  readonly nowMs: number;
  readonly dispatch: (action: Action) => void;
  /**
   * Disable ALL key bindings owned by this component. Tests set this so
   * a sibling keybar fixture can own routing, and so snapshot tests
   * don't race.
   */
  readonly inputDisabled?: boolean;
  /**
   * Test hook — injected mock of `applyFilter` so memoisation tests can
   * observe call counts. Production callers omit this.
   */
  readonly applyFilterImpl?: typeof applyFilter;
  /**
   * Callback fired when the user presses `r` on a terminal-state row
   * (complete / error / cancelled). App wires it to the run-entry flow
   * (plan §4.2). Silently ignored on active rows — hide-don't-grey.
   */
  readonly onStartRun?: (info: RunInfo) => void;
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
  onStartRun,
}: RunsTableProps): React.ReactElement {
  const theme = useTheme();
  const paneHeight = height ?? DEFAULT_HEIGHT;
  const cursorIndex = cursor;

  const [viewportOffset, setViewportOffset] = useState<number>(0);

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

  // ---------------------------------------------------------------------
  // Cursor reconciliation (P5-T3 §4.5)
  //
  // When the sorted row set changes (filter apply, archive toggle, new
  // rows from the feed), re-place the cursor: prefer preserving the
  // selected run-id, fall back to clamping to the last visible index.
  // The reducer does not know `rows.length` so this runs at the component
  // layer; the dispatched `RUNS_CURSOR_JUMP` is a no-op when the target
  // already equals `state.runsCursor`, keeping the effect idempotent.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const next = reconcileCursorAfterRowsChange(
      cursorIndex,
      selectedRunId,
      sortedRows,
    );
    if (next !== cursorIndex) {
      dispatch({ type: "RUNS_CURSOR_JUMP", index: next });
    }
  }, [sortedRows, cursorIndex, selectedRunId, dispatch]);

  // ---------------------------------------------------------------------
  // Derived selection: whenever the row under the *clamped* cursor has a
  // different id from `state.selectedRunId`, emit `RUNS_SELECT`. Using
  // `windowState.cursor` guarantees the index is within bounds even when
  // the raw `state.runsCursor` is momentarily stale. The reducer coerces
  // `RUNS_SELECT` to a no-op when the id matches, so the loop is bounded.
  // ---------------------------------------------------------------------
  const derivedSelected =
    sortedRows.length > 0 ? sortedRows[windowState.cursor]?.id ?? null : null;
  useEffect(() => {
    if (derivedSelected !== selectedRunId) {
      dispatch({ type: "RUNS_SELECT", runId: derivedSelected });
    }
  }, [derivedSelected, selectedRunId, dispatch]);

  // ---------------------------------------------------------------------
  // Key routing
  //
  // Single `useInput` for all component-owned keys. Suppressed while the
  // filter bar is open (it owns keystrokes) or while `inputDisabled` is
  // set. Each branch dispatches a single action and returns — keystrokes
  // never fall through to sibling handlers.
  // ---------------------------------------------------------------------
  useInput(
    (input, key) => {
      // Existing component-owned letter keys.
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

      // `r` Run — start a fresh run of the same workflow (P9-T1). Scoped
      // to terminal rows (hide-don't-grey on active runs).
      if (input === "r") {
        const row = sortedRows[windowState.cursor];
        if (!row) return;
        const terminal =
          row.info.status === "complete" || row.info.status === "error";
        if (!terminal) return;
        if (onStartRun) onStartRun(row.info);
        return;
      }

      // Cursor movement.
      if (key.upArrow || input === "k") {
        dispatch({ type: "RUNS_CURSOR_MOVE", delta: -1 });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "RUNS_CURSOR_MOVE", delta: +1 });
        return;
      }
      if (key.pageUp) {
        if (visibleRows > 0 && sortedRows.length > 0) {
          dispatch({
            type: "RUNS_CURSOR_PAGE",
            direction: "up",
            pageSize: visibleRows,
            rowCount: sortedRows.length,
          });
        }
        return;
      }
      if (key.pageDown) {
        if (visibleRows > 0 && sortedRows.length > 0) {
          dispatch({
            type: "RUNS_CURSOR_PAGE",
            direction: "down",
            pageSize: visibleRows,
            rowCount: sortedRows.length,
          });
        }
        return;
      }
      if (input === "g") {
        dispatch({ type: "RUNS_CURSOR_HOME" });
        return;
      }
      if (input === "G") {
        dispatch({
          type: "RUNS_CURSOR_END",
          rowCount: sortedRows.length,
        });
        return;
      }

      // Enter — zoom into RUN mode on the currently selected row.
      if (key.return) {
        const id = sortedRows[windowState.cursor]?.id;
        if (id !== undefined && id.length > 0) {
          dispatch({ type: "MODE_OPEN_RUN", runId: id });
        }
        return;
      }
    },
    { isActive: !inputDisabled && !runsFilter.open },
  );

  const windowSlice = useMemo(
    () => sliceWindow(sortedRows, windowState),
    [sortedRows, windowState.offset, windowState.visibleRows],
  );

  const columns = pickColumnSet(width);
  const widths = computeColumnWidths(columns, width);

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
