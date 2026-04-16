// src/runs/types.ts
//
// Public types for the runs-table module (P5-T1). Type-only — zero runtime
// exports. Pure, purity-scanned by test/state/purity.test.ts.
//
// Authoritative references:
//   - docs/tui/features.md §3.2 (Run list with filtering)
//   - docs/tui/mockups.md §1 top half (runs table layout), §3 (alternate
//     widths), §12 (column-drop order)
//   - docs/tui/plans/P5-T1.md §3, §4, §5
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Only type-only imports from
// `markflow` (the engine library) and the local theme tokens module are
// allowed. Runtime imports must stay inside this pure envelope.

import type { RunInfo } from "markflow";
import type { ColorRole } from "../theme/tokens.js";
import type { GlyphKey } from "../theme/glyphs.js";

// ---------------------------------------------------------------------------
// Sort keys and direction — cycled via the `s` binding
// ---------------------------------------------------------------------------

/**
 * Keys the user can cycle through via `s`. `"attention"` is the default
 * and the only key whose compare is non-trivial — it buckets active vs.
 * terminal runs. See `sort.ts::attentionCompare` for details.
 *
 * Cycle order (wraps):
 *   attention → started → ended → elapsed → status → workflow → id → attention
 */
export type SortKey =
  | "attention"
  | "started"
  | "ended"
  | "elapsed"
  | "status"
  | "workflow"
  | "id";

export type SortDirection = "asc" | "desc";

export interface RunsSortState {
  readonly key: SortKey;
  readonly direction: SortDirection;
}

// ---------------------------------------------------------------------------
// Attention bucket — used internally by `attentionCompare`
// ---------------------------------------------------------------------------

export type AttentionBucket = "active" | "terminal";

// ---------------------------------------------------------------------------
// Status cell — structured value carried by the status column
// ---------------------------------------------------------------------------

/**
 * Structured status cell. The column returns this (via `projectStatus`) so
 * the Ink layer can render `<Text color={theme.colors[role].color}>` while
 * the pure column module stays theme-agnostic.
 */
export interface StatusCell {
  readonly glyph: string;
  readonly label: string;
  readonly role: ColorRole;
  readonly glyphKey: GlyphKey;
}

// ---------------------------------------------------------------------------
// Row projection — input to `<RunsTable>` and sort primitives
// ---------------------------------------------------------------------------

/**
 * Flat row data handed to `<RunsTable>`. All values are already formatted
 * for display; the component just maps `columns[].projectText(row)` into
 * Ink `<Text>` nodes. Sort keys that need numeric/date comparison derive
 * their value from `info` directly — see `sort.ts`.
 */
export interface RunsTableRow {
  readonly id: string;
  readonly idShort: string;
  readonly workflow: string;
  readonly statusLabel: string;
  readonly statusCell: StatusCell;
  readonly step: string;
  readonly elapsed: string;
  readonly elapsedMs: number;
  readonly started: string;
  readonly note: string;
  readonly info: RunInfo;
}

// ---------------------------------------------------------------------------
// Column definitions — data-driven layout
// ---------------------------------------------------------------------------

export type ColumnAlign = "left" | "right";

/**
 * Column definition as data. `width` is the rendered budget in columns
 * (including padding). `grow: true` marks a single column per set that
 * absorbs leftover width; exactly one per set is validated by tests.
 *
 * `projectText` returns the plain text projection used by both the pure
 * layout and the Ink renderer. `projectStatus` is optional and only the
 * `"status"` column returns a value; the Ink layer uses it to color the
 * cell via `theme.colors[role].color`.
 */
export interface RunsTableColumn {
  readonly id:
    | "id"
    | "workflow"
    | "status"
    | "step"
    | "elapsed"
    | "started"
    | "note";
  readonly header: string;
  readonly width: number;
  readonly grow?: boolean;
  readonly align: ColumnAlign;
  readonly projectText: (row: RunsTableRow) => string;
  readonly projectStatus?: (row: RunsTableRow) => StatusCell;
}
