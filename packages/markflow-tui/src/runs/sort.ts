// src/runs/sort.ts
//
// Pure sort primitives for the runs table (P5-T1).
//
// Authoritative references:
//   - docs/tui/features.md §3.2 (attention-first default)
//   - docs/tui/plans/P5-T1.md §4 (attention bucketing + key-by-key compares)
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` and the sibling `types.js` module.

import type { RunInfo, RunStatus } from "markflow";
import type {
  AttentionBucket,
  RunsSortState,
  RunsTableRow,
  SortKey,
} from "./types.js";

// ---------------------------------------------------------------------------
// Cycle key permutation
// ---------------------------------------------------------------------------

/**
 * Documented cycle order (matches plan §3.1). Wraps from "id" back to
 * "attention". Exported for tests.
 */
export const SORT_KEY_ORDER: ReadonlyArray<SortKey> = Object.freeze([
  "attention",
  "started",
  "ended",
  "elapsed",
  "status",
  "workflow",
  "id",
]);

/**
 * Advance to the next sort key. Unknown keys defensively reset to
 * `"attention"` — this branch never fires in practice because callers
 * only ever pass a value we produced, but it keeps the function total.
 */
export function cycleSortKey(current: SortKey): SortKey {
  const i = SORT_KEY_ORDER.indexOf(current);
  if (i < 0) return "attention";
  return SORT_KEY_ORDER[(i + 1) % SORT_KEY_ORDER.length]!;
}

// ---------------------------------------------------------------------------
// Attention bucketing
// ---------------------------------------------------------------------------

/**
 * Attention bucket: active runs (running or suspended awaiting approval)
 * always sort before terminal runs (complete or error) regardless of the
 * other tie-breakers. Matches mockups §1 where ▶/⏸ rows sit above ✗/✓ rows.
 */
export function attentionBucket(info: RunInfo): AttentionBucket {
  if (info.status === "running" || info.status === "suspended") return "active";
  return "terminal";
}

function parseIso(iso: string | undefined | null): number {
  if (iso == null) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function endedKey(info: RunInfo): number {
  return parseIso(info.completedAt ?? info.startedAt);
}

function idCompare(a: RunInfo, b: RunInfo): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The default compare. Buckets by `attentionBucket`, then sorts within the
 * bucket by the relevant timestamp desc, breaking ties by `id` asc.
 */
export function attentionCompare(a: RunsTableRow, b: RunsTableRow): number {
  const ab = attentionBucket(a.info);
  const bb = attentionBucket(b.info);
  if (ab !== bb) return ab === "active" ? -1 : 1;

  const aKey =
    ab === "active" ? parseIso(a.info.startedAt) : endedKey(a.info);
  const bKey =
    bb === "active" ? parseIso(b.info.startedAt) : endedKey(b.info);
  if (aKey !== bKey) return bKey - aKey;

  return idCompare(a.info, b.info);
}

// ---------------------------------------------------------------------------
// Non-attention compares — one per SortKey
// ---------------------------------------------------------------------------

/** Ordinal used by `status` sort. Actionables first, ok last. */
const STATUS_ORDINAL: Readonly<Record<RunStatus, number>> = Object.freeze({
  running: 0,
  suspended: 1,
  error: 2,
  complete: 3,
});

function statusCompare(a: RunsTableRow, b: RunsTableRow): number {
  const sa = STATUS_ORDINAL[a.info.status];
  const sb = STATUS_ORDINAL[b.info.status];
  if (sa !== sb) return sa - sb;
  const ta = parseIso(a.info.startedAt);
  const tb = parseIso(b.info.startedAt);
  if (ta !== tb) return tb - ta;
  return idCompare(a.info, b.info);
}

function workflowCompare(a: RunsTableRow, b: RunsTableRow): number {
  const na = a.info.workflowName.toLocaleLowerCase();
  const nb = b.info.workflowName.toLocaleLowerCase();
  if (na < nb) return -1;
  if (na > nb) return 1;
  return idCompare(a.info, b.info);
}

/**
 * Pure key-specific compare. Non-attention keys are ordinary numeric or
 * lexical compares with `id asc` tie-break.
 */
export function compareByKey(
  a: RunsTableRow,
  b: RunsTableRow,
  key: SortKey,
): number {
  switch (key) {
    case "attention":
      return attentionCompare(a, b);
    case "started": {
      const ta = parseIso(a.info.startedAt);
      const tb = parseIso(b.info.startedAt);
      if (ta !== tb) return tb - ta;
      return idCompare(a.info, b.info);
    }
    case "ended": {
      const ea = endedKey(a.info);
      const eb = endedKey(b.info);
      if (ea !== eb) return eb - ea;
      return idCompare(a.info, b.info);
    }
    case "elapsed": {
      if (a.elapsedMs !== b.elapsedMs) return b.elapsedMs - a.elapsedMs;
      return idCompare(a.info, b.info);
    }
    case "status":
      return statusCompare(a, b);
    case "workflow":
      return workflowCompare(a, b);
    case "id":
      return idCompare(a.info, b.info);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Stable sort wrapper
// ---------------------------------------------------------------------------

/**
 * Sort rows into a fresh array without mutating the input. Stability is
 * preserved by tagging each row with its original index and tie-breaking
 * with it once the compare returns 0.
 *
 * `direction` is always `"desc"` for the bindings we ship today (see plan
 * §3.4), so most key compares are already desc-oriented. When a future
 * `RUNS_SORT_TOGGLE_DIRECTION` binding lands, flipping the sign here is
 * enough to reverse the order while keeping stability.
 */
export function sortRows(
  rows: ReadonlyArray<RunsTableRow>,
  sort: RunsSortState,
): ReadonlyArray<RunsTableRow> {
  if (rows.length <= 1) return rows.slice();
  const indexed = rows.map((row, i) => ({ row, i }));
  const flip = sort.direction === "asc" ? -1 : 1;
  indexed.sort((a, b) => {
    const primary = compareByKey(a.row, b.row, sort.key) * flip;
    if (primary !== 0) return primary;
    return a.i - b.i;
  });
  return indexed.map((x) => x.row);
}
