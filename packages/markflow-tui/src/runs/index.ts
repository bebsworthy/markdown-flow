// src/runs/index.ts
//
// Barrel for the runs-table pure module surface. Re-exports types +
// functions only. Does NOT re-export the React component — importers that
// need the Ink component import from `../components/runs-table.js` directly.

export type {
  SortKey,
  SortDirection,
  RunsSortState,
  AttentionBucket,
  StatusCell,
  RunsTableRow,
  RunsTableColumn,
  ColumnAlign,
  RunsFilterTerm,
  RunsFilterInput,
  RunsFilterState,
  RunsArchivePolicy,
  RunsWindowState,
} from "./types.js";

export { RUNS_ARCHIVE_DEFAULTS } from "./types.js";

export {
  SORT_KEY_ORDER,
  cycleSortKey,
  attentionBucket,
  attentionCompare,
  compareByKey,
  sortRows,
} from "./sort.js";

export {
  COLUMNS_140,
  COLUMNS_100,
  COLUMNS_80,
  pickColumnSet,
  computeColumnWidths,
  fitCell,
  WIDE_TIER_MIN,
  MEDIUM_TIER_MIN,
} from "./columns.js";

export {
  runStatusToRole,
  runStatusToGlyphKey,
  runStatusToLabel,
  formatShortId,
  formatStartedHMS,
  formatElapsed,
  deriveElapsedMs,
  deriveStepLabel,
  deriveNote,
  toStatusCell,
  toRunsTableRow,
} from "./derive.js";

export { tryParseDurationMs } from "./duration.js";

export {
  parseFilterInput,
  applyFilter,
  isArchived,
  applyArchive,
} from "./filter.js";

export {
  computeWindow,
  sliceWindow,
  deriveVisibleRows,
} from "./window.js";
