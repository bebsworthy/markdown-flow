// src/runs/columns.ts
//
// Pure column definitions for the runs table. Each `RunsTableColumn` is a
// data record whose `projectText` runs against a `RunsTableRow`. One column
// per set is marked `grow: true` — the Ink layer gives it the leftover
// width. Column sets vary by terminal width per mockups.md §12.
//
// Authoritative references:
//   - docs/tui/mockups.md §1 (140-col default), §3 (alternate-width
//     columns), §12 (medium-tier drop order)
//   - docs/tui/plans/P5-T1.md §5
//
// PURITY NOTE: no ink/react/node:* imports.

import type { RunsTableColumn, RunsTableRow } from "./types.js";

// ---------------------------------------------------------------------------
// Tier thresholds (mockups §12)
// ---------------------------------------------------------------------------

export const WIDE_TIER_MIN = 120;
export const MEDIUM_TIER_MIN = 90;

// ---------------------------------------------------------------------------
// Wide (140-col default) — matches mockups.md §1 header line
// ---------------------------------------------------------------------------

const COL_ID: RunsTableColumn = Object.freeze({
  id: "id",
  header: "ID",
  width: 8,
  align: "left",
  projectText: (r: RunsTableRow) => r.idShort,
});

const COL_WORKFLOW: RunsTableColumn = Object.freeze({
  id: "workflow",
  header: "WORKFLOW",
  width: 14,
  align: "left",
  projectText: (r: RunsTableRow) => r.workflow,
});

const COL_STATUS: RunsTableColumn = Object.freeze({
  id: "status",
  header: "STATUS",
  width: 12,
  align: "left",
  projectText: (r: RunsTableRow) => r.statusLabel,
  projectStatus: (r: RunsTableRow) => r.statusCell,
});

const COL_STEP: RunsTableColumn = Object.freeze({
  id: "step",
  header: "STEP",
  width: 14,
  align: "left",
  projectText: (r: RunsTableRow) => r.step,
});

const COL_ELAPSED: RunsTableColumn = Object.freeze({
  id: "elapsed",
  header: "ELAPSED",
  width: 10,
  align: "left",
  projectText: (r: RunsTableRow) => r.elapsed,
});

const COL_AGE: RunsTableColumn = Object.freeze({
  id: "elapsed",
  header: "AGE",
  width: 8,
  align: "left",
  projectText: (r: RunsTableRow) => r.elapsed,
});

const COL_STARTED: RunsTableColumn = Object.freeze({
  id: "started",
  header: "STARTED",
  width: 10,
  align: "left",
  projectText: (r: RunsTableRow) => r.started,
});

const COL_NOTE: RunsTableColumn = Object.freeze({
  id: "note",
  header: "NOTE",
  width: 0,
  grow: true,
  align: "left",
  projectText: (r: RunsTableRow) => r.note,
});

// ---------------------------------------------------------------------------
// Column sets — one per width tier (mockups.md §12 drop order)
// ---------------------------------------------------------------------------

/** Wide / 140-col: ID · WORKFLOW · STATUS · STEP · ELAPSED · STARTED · NOTE */
export const COLUMNS_140: ReadonlyArray<RunsTableColumn> = Object.freeze([
  COL_ID,
  COL_WORKFLOW,
  COL_STATUS,
  COL_STEP,
  COL_ELAPSED,
  COL_STARTED,
  COL_NOTE,
]);

/** Medium / ~100-col: drop STARTED, fold ELAPSED → AGE header. */
export const COLUMNS_100: ReadonlyArray<RunsTableColumn> = Object.freeze([
  COL_ID,
  COL_WORKFLOW,
  COL_STATUS,
  COL_STEP,
  COL_AGE,
  COL_NOTE,
]);

/** Narrow / <80-col: drop ELAPSED + STARTED both. */
export const COLUMNS_80: ReadonlyArray<RunsTableColumn> = Object.freeze([
  COL_ID,
  COL_WORKFLOW,
  COL_STATUS,
  COL_STEP,
  COL_NOTE,
]);

// ---------------------------------------------------------------------------
// pickColumnSet — width → column set
// ---------------------------------------------------------------------------

/**
 * Pick the column set appropriate for the given render width. Thresholds
 * match mockups §12:
 *   width >= 120 → COLUMNS_140 (wide)
 *   width >= 90  → COLUMNS_100 (medium; drop STARTED, rename ELAPSED→AGE)
 *   else         → COLUMNS_80  (narrow; drop ELAPSED too)
 * Hide-don't-grey: columns are removed entirely, not rendered in grey.
 */
export function pickColumnSet(
  width: number,
): ReadonlyArray<RunsTableColumn> {
  if (width >= WIDE_TIER_MIN) return COLUMNS_140;
  if (width >= MEDIUM_TIER_MIN) return COLUMNS_100;
  return COLUMNS_80;
}

// ---------------------------------------------------------------------------
// Layout helpers — width distribution
// ---------------------------------------------------------------------------

/**
 * Compute the rendered width for each column given a pane width. The grow
 * column (exactly one per set) absorbs leftover budget after fixed columns
 * are accounted for, with a 1-col gutter between each column and a 1-col
 * leading gutter for the cursor glyph.
 *
 * Returned array is 1:1 with `columns`. Fixed columns get their declared
 * width; the grow column receives `max(4, paneWidth - fixedTotal - gutters)`.
 */
export function computeColumnWidths(
  columns: ReadonlyArray<RunsTableColumn>,
  paneWidth: number,
): ReadonlyArray<number> {
  if (columns.length === 0) return [];
  let fixedTotal = 0;
  let growIndex = -1;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]!;
    if (c.grow) {
      growIndex = i;
    } else {
      fixedTotal += c.width;
    }
  }
  const gutters = Math.max(0, columns.length - 1);
  const leading = 2; // cursor column
  const growBudget = Math.max(
    4,
    paneWidth - fixedTotal - gutters - leading,
  );
  return columns.map((c, i) => {
    if (i === growIndex) return growBudget;
    return c.width;
  });
}

// ---------------------------------------------------------------------------
// Cell text preparation — pad / truncate to column width
// ---------------------------------------------------------------------------

const ELLIPSIS = "…";

/**
 * Truncate + pad a cell value to exactly `width` columns. Right-truncates
 * with a single-char ellipsis for overflow; pads with spaces on the right
 * for underflow (align: "left") or on the left (align: "right").
 */
export function fitCell(
  text: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  if (width <= 0) return "";
  if (text.length === width) return text;
  if (text.length > width) {
    if (width === 1) return ELLIPSIS;
    return text.slice(0, width - 1) + ELLIPSIS;
  }
  const pad = " ".repeat(width - text.length);
  return align === "right" ? pad + text : text + pad;
}
