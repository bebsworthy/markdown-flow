// src/components/runs-table.tsx
//
// Stateless runs-table pane. Composes:
//   - optional `<RunsFilterBar>` when `runsFilter.open === true`
//   - `<DataTable>` with column-set selection + themed status cell
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

import React, { useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import type {
  RunsArchivePolicy,
  RunsFilterState,
  RunsSortState,
  RunsTableRow as RowData,
  RunsTableColumn,
} from "../runs/types.js";
import { pickColumnSet } from "../runs/columns.js";
import { sortRows } from "../runs/sort.js";
import { applyArchive, applyFilter } from "../runs/filter.js";
import { reconcileCursorAfterRowsChange } from "../runs/cursor.js";
import { DataTable, type ColumnDef } from "../primitives/DataTable.js";
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
  readonly cursor: number;
  readonly width: number;
  readonly height?: number;
  readonly nowMs: number;
  readonly dispatch: (action: Action) => void;
  readonly inputDisabled?: boolean;
  readonly applyFilterImpl?: typeof applyFilter;
  readonly onStartRun?: (info: RunInfo) => void;
  readonly runsDir?: string | null;
}

const DEFAULT_HEIGHT = 10;
const FILTER_BAR_ROWS = 2;
const FOOTER_ROWS = 1;

function toDataTableColumns(
  columns: ReadonlyArray<RunsTableColumn>,
  theme: ReturnType<typeof useTheme>,
): ReadonlyArray<ColumnDef<RowData>> {
  return columns.map((col) => {
    const base = {
      id: col.id,
      header: col.header,
      width: col.width,
      grow: col.grow,
      align: col.align,
      render: (row: RowData) => col.projectText(row),
    };

    if (col.id === "status" && col.projectStatus) {
      const projectStatus = col.projectStatus;
      return {
        ...base,
        renderCell: (row: RowData) => {
          const cell = projectStatus(row);
          const themeGlyph = theme.glyphs[cell.glyphKey];
          const spec = theme.colors[cell.role];
          return (
            <Text
              color={spec.color}
              dimColor={spec.dim === true}
              wrap="truncate-end"
            >
              {themeGlyph} {cell.label}
            </Text>
          );
        },
      };
    }

    return base;
  });
}

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
  runsDir: runsDirProp,
}: RunsTableProps): React.ReactElement {
  const theme = useTheme();
  const paneHeight = height ?? DEFAULT_HEIGHT;
  const cursorIndex = cursor;

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
  // Visible row count (for page up/down)
  // ---------------------------------------------------------------------
  const nonTableOverhead =
    (runsFilter.open ? FILTER_BAR_ROWS : 0) + FOOTER_ROWS;
  const dataHeight = Math.max(0, paneHeight - nonTableOverhead);
  const pageSize = Math.max(0, dataHeight - 1); // minus DataTable header

  // Clamped cursor for derived selection + key handlers
  const clampedCursor =
    sortedRows.length > 0
      ? Math.max(0, Math.min(cursorIndex, sortedRows.length - 1))
      : 0;

  // ---------------------------------------------------------------------
  // Cursor reconciliation — only when the row identity set changes.
  // All volatile values read via refs so the effect only fires on
  // rowIdKey transitions, not on every nowMs / cursor render.
  // ---------------------------------------------------------------------
  const cursorRef = useRef(cursorIndex);
  cursorRef.current = cursorIndex;
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;
  const sortedRowsRef = useRef(sortedRows);
  sortedRowsRef.current = sortedRows;

  const rowIdKey = useMemo(
    () => sortedRows.map((r) => r.id).join("\0"),
    [sortedRows],
  );
  useEffect(() => {
    const next = reconcileCursorAfterRowsChange(
      cursorRef.current,
      selectedRunIdRef.current,
      sortedRowsRef.current,
    );
    if (next !== cursorRef.current) {
      dispatch({ type: "RUNS_CURSOR_JUMP", index: next });
    }
  }, [rowIdKey, dispatch]);

  // ---------------------------------------------------------------------
  // Derived selection
  // ---------------------------------------------------------------------
  const derivedSelected =
    sortedRows.length > 0 ? sortedRows[clampedCursor]?.id ?? null : null;
  useEffect(() => {
    if (derivedSelected !== selectedRunId) {
      dispatch({ type: "RUNS_SELECT", runId: derivedSelected });
    }
  }, [derivedSelected, selectedRunId, dispatch]);

  // ---------------------------------------------------------------------
  // Key routing
  // ---------------------------------------------------------------------
  useInput(
    (input, key) => {
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

      if (input === "r") {
        const row = sortedRows[clampedCursor];
        if (!row) return;
        const terminal =
          row.info.status === "complete" || row.info.status === "error";
        if (!terminal) return;
        if (onStartRun) onStartRun(row.info);
        return;
      }

      if (key.upArrow || input === "k") {
        dispatch({ type: "RUNS_CURSOR_MOVE", delta: -1, rowCount: sortedRows.length });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "RUNS_CURSOR_MOVE", delta: +1, rowCount: sortedRows.length });
        return;
      }
      if (key.pageUp) {
        if (pageSize > 0 && sortedRows.length > 0) {
          dispatch({
            type: "RUNS_CURSOR_PAGE",
            direction: "up",
            pageSize,
            rowCount: sortedRows.length,
          });
        }
        return;
      }
      if (key.pageDown) {
        if (pageSize > 0 && sortedRows.length > 0) {
          dispatch({
            type: "RUNS_CURSOR_PAGE",
            direction: "down",
            pageSize,
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

      if (key.return) {
        const row = sortedRows[clampedCursor];
        const id = row?.id;
        const effectiveRunsDir = row?.runsDir ?? runsDirProp;
        if (id !== undefined && id.length > 0 && effectiveRunsDir) {
          dispatch({ type: "MODE_OPEN_RUN", runId: id, runsDir: effectiveRunsDir });
        }
        return;
      }
    },
    { isActive: !inputDisabled && !runsFilter.open },
  );

  // ---------------------------------------------------------------------
  // DataTable columns (memoised on column set + theme)
  // ---------------------------------------------------------------------
  const columns = pickColumnSet(width);
  const dtColumns = useMemo(
    () => toDataTableColumns(columns, theme),
    [columns, theme],
  );

  const filterHasTerms = runsFilter.applied.terms.some(
    (t) => t.kind !== "malformed",
  );
  const archiveActive = !runsArchive.shown && archivedRows.length > 0;

  const emptyNode = (
    <Text
      color={theme.colors.dim.color}
      dimColor={theme.colors.dim.dim === true}
    >
      {filterHasTerms || archiveActive ? "no runs match" : "no runs yet"}
    </Text>
  );

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

      <DataTable<RowData>
        columns={dtColumns}
        rows={sortedRows}
        rowKey={(r) => r.id}
        cursorIndex={clampedCursor}
        width={width}
        height={dataHeight}
        cursorGlyph="▶"
        emptyState={emptyNode}
      />

      <RunsFooter
        shown={archiveShown.length}
        archived={archivedRows.length}
        archiveShown={runsArchive.shown}
        sortKey={sort.key}
        width={width}
      />
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const RunsTable = RunsTableImpl;
