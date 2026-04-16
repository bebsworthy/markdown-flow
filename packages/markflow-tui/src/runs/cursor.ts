// src/runs/cursor.ts
//
// Pure cursor math for the runs table (P5-T3).
//
// Responsibilities:
//   - clampCursor(cursor, rowCount) — bound a candidate cursor into the
//     [0, rowCount-1] range (or 0 when empty).
//   - moveCursor(cursor, delta, rowCount) — shift cursor by a signed delta
//     and clamp.
//   - jumpCursorTo(index, rowCount) — absolute-jump variant with clamp.
//   - rowIdAtCursor(rows, cursor) — look up the row-id at the cursor, or
//     null when out-of-range / empty.
//   - reconcileCursorAfterRowsChange(prevCursor, prevRunId, nextRows) —
//     place the cursor in the new row list preserving the id when possible,
//     otherwise clamping to the last visible index.
//
// Authoritative references:
//   - docs/tui/plans/P5-T3.md §4 (cursor follow-selection semantics).
//
// PURITY NOTE: this module MUST NOT import from `react`, `ink`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Registered in
// test/state/purity.test.ts.

/**
 * Bound a candidate cursor into the `[0, rowCount - 1]` range. When
 * `rowCount <= 0` the only valid cursor is `0`. Non-finite / floating
 * inputs are floored into integers first.
 */
export function clampCursor(cursor: number, rowCount: number): number {
  if (!Number.isFinite(cursor)) return 0;
  if (rowCount <= 0) return 0;
  const floored = Math.floor(cursor);
  if (floored < 0) return 0;
  if (floored > rowCount - 1) return rowCount - 1;
  return floored;
}

/**
 * Shift the cursor by a signed delta then clamp. `delta === 0` returns the
 * input cursor unchanged (callers rely on referential equality for memoisation).
 */
export function moveCursor(
  cursor: number,
  delta: number,
  rowCount: number,
): number {
  if (delta === 0) return clampCursor(cursor, rowCount);
  return clampCursor(cursor + delta, rowCount);
}

/**
 * Jump to an absolute index, clamped. Accepts floats (floored) and
 * negatives (clamped to 0).
 */
export function jumpCursorTo(index: number, rowCount: number): number {
  return clampCursor(index, rowCount);
}

/**
 * Return the id at `cursor` in `rows`, or null when the index is out of
 * range. Defensive against empty rows and non-integer cursors.
 */
export function rowIdAtCursor(
  rows: ReadonlyArray<{ readonly id: string }>,
  cursor: number,
): string | null {
  if (rows.length === 0) return null;
  if (!Number.isFinite(cursor)) return null;
  const idx = Math.floor(cursor);
  if (idx < 0 || idx >= rows.length) return null;
  return rows[idx]!.id;
}

/**
 * Place the cursor in a new row list preserving selection identity when
 * possible.
 *
 *   1. Empty new list → 0.
 *   2. If `prevRunId` still appears in `nextRows`, put the cursor there —
 *      the logical selection follows the run across reorderings.
 *   3. Otherwise clamp `prevCursor` to `[0, nextRows.length - 1]`. The
 *      "keep cursor at the highest still-valid index" rule (plan §4.3)
 *      falls out of the clamp — we never snap to 0 when rows shrink.
 */
export function reconcileCursorAfterRowsChange(
  prevCursor: number,
  prevRunId: string | null,
  nextRows: ReadonlyArray<{ readonly id: string }>,
): number {
  if (nextRows.length === 0) return 0;
  if (prevRunId !== null) {
    const stillHere = nextRows.findIndex((r) => r.id === prevRunId);
    if (stillHere >= 0) return stillHere;
  }
  return clampCursor(prevCursor, nextRows.length);
}
