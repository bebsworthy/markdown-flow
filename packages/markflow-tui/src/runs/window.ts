// src/runs/window.ts
//
// Pure virtualisation math for the runs table (P5-T2).
//
// Responsibilities:
//   - computeWindow(args) — reconcile (cursor, offset, visibleRows) so the
//     cursor is always in view; clamp cursor + offset to valid ranges.
//   - sliceWindow(rows, window) — fresh array containing rows in the window.
//   - deriveVisibleRows(height, headerRows, footerRows) — how many data
//     rows fit in a given pane height.
//
// Authoritative references:
//   - docs/tui/plans/P5-T2.md §7 (virtualisation strategy).
//
// PURITY NOTE: no ink/react/node:* imports.

import type { RunsWindowState } from "./types.js";

/**
 * Reconcile cursor, offset, and visibleRows into a valid window. Cursor
 * movement scrolls the viewport just far enough to keep it visible:
 *   - If cursor < offset → offset = cursor.
 *   - If cursor >= offset + visibleRows → offset = cursor - visibleRows + 1.
 * Otherwise `offset` is unchanged (clamped into the valid range).
 *
 * Degenerate inputs (rowCount <= 0 or visibleRows <= 0) collapse to an
 * empty window.
 */
export function computeWindow(args: {
  readonly rowCount: number;
  readonly cursor: number;
  readonly offset: number;
  readonly visibleRows: number;
}): RunsWindowState {
  const visibleRows = Math.max(0, args.visibleRows);
  if (args.rowCount <= 0 || visibleRows <= 0) {
    return { offset: 0, visibleRows, cursor: 0 };
  }
  const clampedCursor = Math.max(
    0,
    Math.min(args.rowCount - 1, args.cursor),
  );
  let offset = args.offset;
  const maxOffset = Math.max(0, args.rowCount - visibleRows);
  offset = Math.max(0, Math.min(offset, maxOffset));
  if (clampedCursor < offset) offset = clampedCursor;
  if (clampedCursor >= offset + visibleRows) {
    offset = clampedCursor - visibleRows + 1;
  }
  return { offset, visibleRows, cursor: clampedCursor };
}

/**
 * Slice `rows` at the window bounds. Returns a fresh array (never
 * mutates the input). Safe when the window exceeds the row bounds —
 * `Array.prototype.slice` clamps naturally.
 */
export function sliceWindow<T>(
  rows: ReadonlyArray<T>,
  window: { readonly offset: number; readonly visibleRows: number },
): ReadonlyArray<T> {
  return rows.slice(window.offset, window.offset + window.visibleRows);
}

/**
 * Given a pane height and how many rows the header and footer consume,
 * how many data rows fit? Never returns a negative value.
 */
export function deriveVisibleRows(
  height: number,
  headerRows: number,
  footerRows: number,
): number {
  const h = Number.isFinite(height) ? height : 0;
  return Math.max(0, h - headerRows - footerRows);
}
