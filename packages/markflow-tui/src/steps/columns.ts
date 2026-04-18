// src/steps/columns.ts
//
// Pure column definitions for the step table. Each `StepTableColumn` is a
// data record whose `projectText` runs against a `StepRow`. One column per
// set is marked `grow: true` — the Ink layer gives it the leftover width.
// Column sets vary by terminal width per mockups.md §4 (wide),
// `plan §5.2` (medium), `plan §5.3` (narrow).
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §5
//   - docs/tui/mockups.md §4 (wide tier layout)
//
// PURITY NOTE: no ink/react/node:* imports.

import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import { toStepStatusCell } from "./derive.js";
import type {
  StepColumnWidths,
  StepProgressCell,
  StepRow,
  StepStatusCell,
  StepTableColumn,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tier thresholds (match runs/columns.ts tiers)
// ---------------------------------------------------------------------------

export const STEP_WIDE_TIER_MIN = 120;
export const STEP_MEDIUM_TIER_MIN = 90;

// ---------------------------------------------------------------------------
// Cell projections — shared by every tier
// ---------------------------------------------------------------------------

function projectStepLabel(row: StepRow, widths: StepColumnWidths): string {
  void widths; // reserved for future depth-aware truncation; today we rely
  // on fitStepCell inside the Ink layer to handle overflow.
  const indent = "  ".repeat(Math.max(0, row.depth));
  return `${indent}${row.label}`;
}

function projectStatusText(row: StepRow): string {
  const glyph = UNICODE_GLYPHS[row.glyphKey];
  const label = statusLabelForRow(row);
  return `${glyph} ${label}`;
}

function projectStatusCell(row: StepRow): StepStatusCell {
  return toStepStatusCell(row.status);
}

function projectProgress(row: StepRow): StepProgressCell | null {
  if (row.kind !== "batch-aggregate" || !row.aggregate) return null;
  return {
    completed: row.aggregate.completed,
    total: row.aggregate.expected,
    bar: "",
    suffix: "",
  };
}

function statusLabelForRow(row: StepRow): string {
  // Keep aggregate-row status text consistent with leaf rows.
  switch (row.status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "complete":
      return "ok";
    case "skipped":
      return "skipped";
    case "waiting":
      return "waiting";
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = row.status;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COL_STEP: StepTableColumn = Object.freeze({
  id: "step",
  header: "STEP",
  width: 28,
  align: "left",
  projectText: projectStepLabel,
});

const COL_STATUS: StepTableColumn = Object.freeze({
  id: "status",
  header: "STATUS",
  width: 14,
  align: "left",
  projectText: (row: StepRow) => projectStatusText(row),
  projectStatus: projectStatusCell,
});

const COL_ATTEMPT: StepTableColumn = Object.freeze({
  id: "attempt",
  header: "ATTEMPT",
  width: 10,
  align: "left",
  projectText: (row: StepRow) => row.attempt,
});

const COL_ELAPSED: StepTableColumn = Object.freeze({
  id: "elapsed",
  header: "ELAPSED",
  width: 10,
  align: "left",
  projectText: (row: StepRow) => row.elapsed,
});

const COL_NOTE: StepTableColumn = Object.freeze({
  id: "note",
  header: "NOTE",
  width: 0,
  grow: true,
  align: "left",
  projectText: (row: StepRow) => row.note,
  projectProgress,
});

// ---------------------------------------------------------------------------
// Column sets
// ---------------------------------------------------------------------------

/** Wide (>=120 cols) — reference layout (mockups §4 + §6). */
export const STEP_COLUMNS_WIDE: ReadonlyArray<StepTableColumn> = Object.freeze([
  COL_STEP,
  COL_STATUS,
  COL_ATTEMPT,
  COL_ELAPSED,
  COL_NOTE,
]);

/** Medium (~90–120 cols) — drop ATTEMPT column. */
export const STEP_COLUMNS_MEDIUM: ReadonlyArray<StepTableColumn> = Object.freeze([
  COL_STEP,
  COL_STATUS,
  COL_ELAPSED,
  COL_NOTE,
]);

/** Narrow (<90 cols) — drop ATTEMPT and ELAPSED. */
export const STEP_COLUMNS_NARROW: ReadonlyArray<StepTableColumn> = Object.freeze([
  COL_STEP,
  COL_STATUS,
  COL_NOTE,
]);

// ---------------------------------------------------------------------------
// pickStepColumnSet — width → column set
// ---------------------------------------------------------------------------

export function pickStepColumnSet(
  width: number,
): ReadonlyArray<StepTableColumn> {
  if (width >= STEP_WIDE_TIER_MIN) return STEP_COLUMNS_WIDE;
  if (width >= STEP_MEDIUM_TIER_MIN) return STEP_COLUMNS_MEDIUM;
  return STEP_COLUMNS_NARROW;
}

