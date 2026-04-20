// src/steps/aggregate.ts
//
// forEach batch aggregation: build a single "batch-aggregate" row for
// batches whose `expected` count meets the collapse threshold. The aggregate
// row pre-renders its progress bar and retry/failed summary so the Ink
// render layer stays stateless.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §4
//   - docs/tui/mockups.md §4 (running aggregate) + §6 (failed aggregate)
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` and runtime imports from sibling pure modules + theme glyphs.

import type { BatchState, Token } from "markflow-cli";
import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import type { GlyphKey } from "../theme/glyphs.js";
import type { ColorRole } from "../theme/tokens.js";
import { formatStepElapsed } from "./derive.js";
import type { RetryHintMap } from "./retry.js";
import type {
  BatchAggregate,
  BatchAggregateStatus,
  StepRow,
  StepsSnapshot,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum `BatchState.expected` count at which a forEach batch collapses
 * into a single aggregate row. 2 matches mockups §4 / §6 (both aggregate
 * a 3-item batch); raising this would render sub-threshold batches inline.
 */
export const BATCH_COLLAPSE_THRESHOLD = 2;

/** Default progress-bar width in glyphs (matches mockup §4). */
export const DEFAULT_PROGRESS_BAR_WIDTH = 9;

// ---------------------------------------------------------------------------
// Threshold predicate
// ---------------------------------------------------------------------------

/**
 * Return `true` when the batch should be aggregated into a single row.
 * A zero `expected` batch never aggregates (degenerate case).
 */
export function shouldAggregateBatch(
  batch: BatchState,
  threshold: number = BATCH_COLLAPSE_THRESHOLD,
): boolean {
  if (batch.expected <= 0) return false;
  return batch.expected >= threshold;
}

// ---------------------------------------------------------------------------
// Progress-bar rendering (pre-rendered glyphs — Ink layer reads verbatim)
// ---------------------------------------------------------------------------

/**
 * Render a progress bar as a string of `█` / `░` glyphs.
 * - width <= 0 → empty string.
 * - total <= 0 → empty string.
 * - completed clamped to [0, total].
 * The caller picks the glyph pair (we default to UNICODE; the Ink layer
 * substitutes `theme.glyphs.progressFilled` / `progressEmpty` at render
 * time for capability-driven fallback).
 */
export function formatProgressBar(
  completed: number,
  total: number,
  width: number,
  filledGlyph: string = UNICODE_GLYPHS.progressFilled,
  emptyGlyph: string = UNICODE_GLYPHS.progressEmpty,
): string {
  if (width <= 0 || total <= 0) return "";
  const ratio = Math.max(0, Math.min(1, completed / total));
  const filled = Math.round(ratio * width);
  return filledGlyph.repeat(filled) + emptyGlyph.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export function deriveAggregateStatus(batch: BatchState): BatchAggregateStatus {
  if (!batch.done) return "running";
  if (batch.status === "error") return "failed";
  return "complete";
}

function aggregateRole(status: BatchAggregateStatus): ColorRole {
  switch (status) {
    case "running":
      return "running";
    case "complete":
      return "complete";
    case "failed":
      return "failed";
  }
}

const AGGREGATE_GLYPH_KEY: GlyphKey = "batch";

// ---------------------------------------------------------------------------
// Retry / elapsed derivation from the token set
// ---------------------------------------------------------------------------

function earliestStartedAtForBatch(
  batchId: string,
  tokens: ReadonlyMap<string, Token>,
): string | null {
  let earliest: number | null = null;
  let earliestIso: string | null = null;
  for (const t of tokens.values()) {
    if (t.batchId !== batchId) continue;
    if (!t.result) continue;
    const ms = Date.parse(t.result.started_at);
    if (!Number.isFinite(ms)) continue;
    if (earliest == null || ms < earliest) {
      earliest = ms;
      earliestIso = t.result.started_at;
    }
  }
  return earliestIso;
}

function retriesInFlight(
  batchId: string,
  tokens: ReadonlyMap<string, Token>,
  retryHints: RetryHintMap,
): number {
  let count = 0;
  for (const t of tokens.values()) {
    if (t.batchId !== batchId) continue;
    if (retryHints.has(t.id)) count += 1;
  }
  return count;
}

function deriveAggregateElapsedMs(
  batch: BatchState,
  batchId: string,
  tokens: ReadonlyMap<string, Token>,
  nowMs: number,
): number {
  const earliestIso = earliestStartedAtForBatch(batchId, tokens);
  if (!earliestIso) return 0;
  const start = Date.parse(earliestIso);
  if (!Number.isFinite(start)) return 0;
  // For a done batch, use the latest completed_at among members.
  if (batch.done) {
    let latest = start;
    for (const t of tokens.values()) {
      if (t.batchId !== batchId) continue;
      if (!t.result) continue;
      const c = Date.parse(t.result.completed_at);
      if (Number.isFinite(c) && c > latest) latest = c;
    }
    return Math.max(0, latest - start);
  }
  return Math.max(0, nowMs - start);
}

// ---------------------------------------------------------------------------
// BatchAggregate builder
// ---------------------------------------------------------------------------

export function toBatchAggregate(
  batch: BatchState,
  batchId: string,
  snapshot: StepsSnapshot,
  retryHints: RetryHintMap,
): BatchAggregate {
  return {
    batchId,
    nodeId: batch.nodeId,
    label: `${UNICODE_GLYPHS.batch} batch [${batch.nodeId}]`,
    expected: batch.expected,
    completed: batch.completed,
    succeeded: batch.succeeded,
    failed: batch.failed,
    retries: retriesInFlight(batchId, snapshot.tokens, retryHints),
    status: deriveAggregateStatus(batch),
    earliestStartedAt: earliestStartedAtForBatch(batchId, snapshot.tokens),
  };
}

// ---------------------------------------------------------------------------
// NOTE composition
// ---------------------------------------------------------------------------

/**
 * Render the NOTE-column text for a batch aggregate row. Format:
 *   "<completed> / <expected>   <bar>   <retry-summary>"
 *
 * Running: retry-summary = "N retry · M failed" (lowercase, pluralise).
 * Done + error: retry-summary = "M ✗ · K ⏸" (failed/waiting glyph summary).
 * Done + ok: no retry-summary suffix.
 */
export function formatAggregateNote(
  aggregate: BatchAggregate,
  barWidth: number = DEFAULT_PROGRESS_BAR_WIDTH,
): string {
  const bar = formatProgressBar(
    aggregate.completed,
    aggregate.expected,
    barWidth,
  );
  const count = `${aggregate.completed} / ${aggregate.expected}`;
  let suffix: string;
  if (aggregate.status === "running") {
    const retryWord = aggregate.retries === 1 ? "retry" : "retries";
    suffix = `${aggregate.retries} ${retryWord} \u00b7 ${aggregate.failed} failed`;
  } else if (aggregate.status === "failed") {
    // Terminal + error: show failed/waiting glyph summary (per mockup §6).
    // `waiting` count is best-effort: tokens in the batch whose state is
    // "waiting" at the time this row was built. For MVP we report 0 when
    // the aggregate is terminal — the snapshot no longer surfaces live
    // waiting counts on `BatchState`. The exact column wording in mockup
    // §6 is "1 ✗ · 0 ⏸".
    suffix = `${aggregate.failed} ${UNICODE_GLYPHS.fail} \u00b7 0 ${UNICODE_GLYPHS.waiting}`;
  } else {
    // Done + ok: omit suffix for a clean terminal display.
    suffix = "";
  }
  if (bar === "" && suffix === "") return count;
  const parts = [count];
  if (bar !== "") parts.push(bar);
  if (suffix !== "") parts.push(suffix);
  return parts.join("   ");
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------

/**
 * Build a `"batch-aggregate"` `StepRow` from a `BatchState`. The caller
 * supplies `depth`, which the row inherits from its forEach source token
 * (so the aggregate visually sits at the same depth as the fan-out parent
 * that spawned the batch).
 */
export function aggregateBatchRow(
  batch: BatchState,
  batchId: string,
  depth: number,
  snapshot: StepsSnapshot,
  retryHints: RetryHintMap,
  nowMs: number,
): StepRow {
  const aggregate = toBatchAggregate(batch, batchId, snapshot, retryHints);
  const elapsedMs = deriveAggregateElapsedMs(
    batch,
    batchId,
    snapshot.tokens,
    nowMs,
  );
  const status = aggregate.status;
  return {
    id: `batch:${batchId}`,
    kind: "batch-aggregate",
    depth,
    label: aggregate.label,
    status,
    attempt: "\u2014",
    elapsed: formatStepElapsed(elapsedMs),
    elapsedMs,
    note: formatAggregateNote(aggregate),
    aggregate,
    role: aggregateRole(status),
    glyphKey: AGGREGATE_GLYPH_KEY,
    nodeId: batch.nodeId,
  };
}
