// src/steps/types.ts
//
// Public types for the step-table module (P6-T1). Type-only — zero runtime
// exports keeps this file's purity envelope trivial (matches the original
// discipline of `src/runs/types.ts`).
//
// Authoritative references:
//   - docs/tui/features.md §3.3 + §5.10
//   - docs/tui/mockups.md §4 (running) + §6 (terminal)
//   - docs/tui/plans/P6-T1.md §2
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Only type-only imports are
// permitted.

import type { BatchState, StepResult, Token } from "markflow-cli";
import type { GlyphKey } from "../theme/glyphs.js";
import type { ColorRole } from "../theme/tokens.js";

// ---------------------------------------------------------------------------
// StepStatus — user-facing status label
// ---------------------------------------------------------------------------

/**
 * User-facing status label for a step row. Derived from `Token.state` with
 * two synthetic overlays not present in the engine's `TokenState`:
 *
 *   - `"retrying"` — layered over a running/pending token when the most
 *     recent `step:retry` event is still live (see `src/steps/retry.ts`).
 *   - `"failed"`   — synthesised from `(state === "complete") && result.edge`
 *     starting with `"fail"`. See `src/steps/derive.ts::tokenToStatus`.
 *
 * Maps 1:1 onto `ColorRole` via `stepStatusToRole` and a glyph via
 * `stepStatusToGlyphKey`.
 */
export type StepStatus =
  | "pending"
  | "running"
  | "complete"
  | "skipped"
  | "waiting"
  | "retrying"
  | "failed";

// ---------------------------------------------------------------------------
// StepRowKind — leaf vs aggregate
// ---------------------------------------------------------------------------

export type StepRowKind = "leaf" | "batch-aggregate";

// ---------------------------------------------------------------------------
// BatchAggregate — rolled-up forEach batch row data
// ---------------------------------------------------------------------------

export type BatchAggregateStatus = "running" | "complete" | "failed";

export interface BatchAggregate {
  readonly batchId: string;
  /** `BatchState.nodeId` — the forEach source node. */
  readonly nodeId: string;
  /** Derived display label — e.g. `"batch [regions]"`. */
  readonly label: string;
  readonly expected: number;
  readonly completed: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Best-effort count of in-flight retries for tokens with this batchId. */
  readonly retries: number;
  readonly status: BatchAggregateStatus;
  /** ISO — earliest `started_at` among batch tokens. */
  readonly earliestStartedAt: string | null;
}

// ---------------------------------------------------------------------------
// RetryHint — fed from `step:retry` events, consumed by the NOTE column
// ---------------------------------------------------------------------------

export interface RetryHint {
  readonly tokenId: string;
  readonly nodeId: string;
  /** 1-indexed attempt that will run after the delay ends. */
  readonly attempt: number;
  /** Absolute ms timestamp when the delay was recorded (parsed from event.ts). */
  readonly scheduledAtMs: number;
  /** `delayMs` verbatim from the event. */
  readonly delayMs: number;
  readonly reason: "fail" | "timeout";
}

// ---------------------------------------------------------------------------
// StepRow — one rendered row's data (leaf or aggregate)
// ---------------------------------------------------------------------------

export interface StepRow {
  /** Unique per-row id — `token.id` for leaves, `"batch:" + batchId` for aggregates. */
  readonly id: string;
  readonly kind: StepRowKind;
  /** 0 = root, 1 = child-of-fan-out, 2 = grandchild, ... */
  readonly depth: number;
  /** Display label (STEP column text before truncation). */
  readonly label: string;
  readonly status: StepStatus;
  /** `"2/3"` or `"—"` (no budget / aggregate row). */
  readonly attempt: string;
  /** Rendered ELAPSED value (`"14s"`, `"2:14"`, `"1h3m"`, `"—"`). */
  readonly elapsed: string;
  readonly elapsedMs: number;
  /** Rendered NOTE text (retry countdown, upstream-failed, "→ next", etc.). */
  readonly note: string;
  /** Aggregate-only data; populated iff `kind === "batch-aggregate"`. */
  readonly aggregate?: BatchAggregate;
  readonly role: ColorRole;
  readonly glyphKey: GlyphKey;
  /** The underlying token id if kind === "leaf"; used for cursor tests (P6-T2). */
  readonly tokenId?: string;
  /** The node id (stable across replays of the same run). */
  readonly nodeId: string;
}

// ---------------------------------------------------------------------------
// Column alignment + cell types (mirror `runs/types.ts`)
// ---------------------------------------------------------------------------

export type ColumnAlign = "left" | "right";

export interface StepStatusCell {
  readonly glyph: string;
  readonly label: string;
  readonly role: ColorRole;
  readonly glyphKey: GlyphKey;
}

export interface StepProgressCell {
  readonly completed: number;
  readonly total: number;
  /** Pre-rendered "██████░░░" glyphs (or ASCII fallback). */
  readonly bar: string;
  /** "1 retry · 0 failed" — already-formatted retry/failed summary. */
  readonly suffix: string;
}

export type StepColumnId = "step" | "status" | "attempt" | "elapsed" | "note";

export type StepColumnWidths = ReadonlyMap<StepColumnId, number>;

export interface StepTableColumn {
  readonly id: StepColumnId;
  readonly header: string;
  readonly width: number;
  readonly grow?: boolean;
  readonly align: ColumnAlign;
  /** Project the plain-text value for a row. Widths map available for indent math. */
  readonly projectText: (row: StepRow, widths: StepColumnWidths) => string;
  /** Optional: colored status cell. */
  readonly projectStatus?: (row: StepRow) => StepStatusCell;
  /** Optional: aggregate-only progress-bar payload. */
  readonly projectProgress?: (row: StepRow) => StepProgressCell | null;
}

// ---------------------------------------------------------------------------
// StepsSnapshot — minimal pure-friendly engine projection
// ---------------------------------------------------------------------------

/**
 * The slice of engine snapshot state the step-table pure surface needs.
 * Kept deliberately narrower than the full `EngineSnapshot` so tests can
 * hand-craft fixtures without folding the entire engine replay.
 */
export interface StepsSnapshot {
  readonly tokens: ReadonlyMap<string, Token>;
  readonly retryBudgets: ReadonlyMap<string, { count: number; max: number }>;
  readonly completedResults: ReadonlyArray<StepResult>;
  readonly batches: ReadonlyMap<string, BatchState>;
}
