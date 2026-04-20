// src/steps/tree.ts
//
// Tree construction for the step table — turns an engine snapshot (minimal
// projection) + live RunInfo + retry-hint map + `nowMs` tick into a flat
// ordered list of `StepRow` records (depth-first, parent/child via
// indentation; forEach batches aggregated into a single row).
//
// Also exposes `projectStepsSnapshot(events, info)` — a permissive,
// ring-buffer-safe folder that produces a `StepsSnapshot` from the capped
// tail of engine events the TUI slice keeps on `EngineState.activeRun`.
// We cannot reuse `replay()` directly because it requires a strict
// monotonic log starting from `run:start`; our 500-event ring may begin
// mid-run.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §3, §4, §8
//   - docs/tui/features.md §3.3
//   - docs/tui/mockups.md §4, §6
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` + runtime imports from sibling pure modules + theme constants.

import type {
  BatchItemResult,
  BatchState,
  EngineEvent,
  ForEachItemErrorMode,
  RunInfo,
  StepResult,
  Token,
  TokenState,
} from "markflow-cli";
import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import {
  aggregateBatchRow,
  BATCH_COLLAPSE_THRESHOLD,
  shouldAggregateBatch,
} from "./aggregate.js";
import {
  deriveStepElapsedMs,
  formatAttempt,
  formatEdgeNote,
  formatStepElapsed,
  formatWaitingNote,
  stepStatusToGlyphKey,
  stepStatusToLabel,
  stepStatusToRole,
  tokenToStatus,
} from "./derive.js";
import { formatRetryCountdown } from "./retry.js";
import type { RetryHintMap } from "./retry.js";
import type {
  StepRow,
  StepsSnapshot,
  StepStatus,
} from "./types.js";
import { upstreamNoteLabel } from "./upstream.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildStepRowsOptions {
  readonly collapseThreshold?: number;
}

const EMPTY_ROWS: ReadonlyArray<StepRow> = Object.freeze([]);

/**
 * Build the flat ordered list of `StepRow` entries for the step table.
 * Pure — equal inputs yield equal outputs (modulo `nowMs` for elapsed +
 * retry-countdown math).
 */
export function buildStepRows(
  snapshot: StepsSnapshot,
  info: RunInfo | null,
  nowMs: number,
  retryHints: RetryHintMap,
  opts?: BuildStepRowsOptions,
): ReadonlyArray<StepRow> {
  if (snapshot.tokens.size === 0) return EMPTY_ROWS;
  const threshold = opts?.collapseThreshold ?? BATCH_COLLAPSE_THRESHOLD;
  const rows: StepRow[] = [];
  const seenBatches = new Set<string>();
  const childrenByParent = indexByParent(snapshot.tokens);
  const roots = orderRoots(snapshot, info);

  function visit(token: Token, depth: number): void {
    if (token.batchId != null) {
      const b = snapshot.batches.get(token.batchId);
      if (b && shouldAggregateBatch(b, threshold)) {
        if (seenBatches.has(token.batchId)) return;
        seenBatches.add(token.batchId);
        rows.push(
          aggregateBatchRow(
            b,
            token.batchId,
            depth,
            snapshot,
            retryHints,
            nowMs,
          ),
        );
        return;
      }
    }
    rows.push(
      toLeafRow(token, depth, info, snapshot, retryHints, nowMs),
    );
    const children = childrenByParent.get(token.id) ?? [];
    for (const c of children) visit(c, depth + 1);
  }

  for (const root of roots) visit(root, 0);
  return rows;
}

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

/**
 * Group children tokens by their `parentTokenId`. Children within the
 * same parent are ordered by earliest `started_at` when available, falling
 * back to token-insertion order.
 */
export function indexByParent(
  tokens: ReadonlyMap<string, Token>,
): Map<string, Token[]> {
  const byParent = new Map<string, Token[]>();
  for (const t of tokens.values()) {
    if (t.parentTokenId == null) continue;
    const list = byParent.get(t.parentTokenId) ?? [];
    list.push(t);
    byParent.set(t.parentTokenId, list);
  }
  for (const [, list] of byParent) {
    list.sort(compareChildren);
  }
  return byParent;
}

/**
 * Compare two child tokens. Earlier-started first; ties broken by
 * `itemIndex` (for forEach siblings), then `tokenId` ascending.
 */
function compareChildren(a: Token, b: Token): number {
  const as = a.result ? Date.parse(a.result.started_at) : NaN;
  const bs = b.result ? Date.parse(b.result.started_at) : NaN;
  const aFinite = Number.isFinite(as);
  const bFinite = Number.isFinite(bs);
  if (aFinite && bFinite) {
    if (as !== bs) return as - bs;
  } else if (aFinite !== bFinite) {
    // One has a started_at, the other doesn't — started-first wins.
    return aFinite ? -1 : 1;
  }
  const ai = a.itemIndex ?? Infinity;
  const bi = b.itemIndex ?? Infinity;
  if (ai !== bi) return ai - bi;
  return a.id.localeCompare(b.id);
}

/**
 * Order root tokens (those with no `parentTokenId`). Completed roots come
 * first in `info.steps[]` order; remaining roots fall in token-insertion
 * order. This is a best-effort topological approximation — the TUI does
 * not see the `FlowGraph` so we cannot do a strict sort.
 */
export function orderRoots(
  snapshot: StepsSnapshot,
  info: RunInfo | null,
): ReadonlyArray<Token> {
  const roots: Token[] = [];
  for (const t of snapshot.tokens.values()) {
    if (t.parentTokenId == null) roots.push(t);
  }
  if (roots.length <= 1) return roots;

  // Build a per-node completion index from info.steps (earliest completion
  // first). If multiple completions exist for the same node, the first
  // index wins — roots of later generations fall through to insertion order.
  const completionIndex = new Map<string, number>();
  if (info) {
    info.steps.forEach((s, i) => {
      if (!completionIndex.has(s.node)) completionIndex.set(s.node, i);
    });
  }

  // Split into completed (have an index) and other (don't). Sort completed
  // by their index; keep other in token-insertion order (map iteration order).
  const completed: Array<[number, Token]> = [];
  const other: Token[] = [];
  for (const t of roots) {
    const idx = completionIndex.get(t.nodeId);
    if (idx != null && t.state === "complete") {
      completed.push([idx, t]);
    } else {
      other.push(t);
    }
  }
  completed.sort((a, b) => a[0] - b[0]);
  return [...completed.map(([, t]) => t), ...other];
}

// ---------------------------------------------------------------------------
// Leaf-row projection
// ---------------------------------------------------------------------------

function toLeafRow(
  token: Token,
  depth: number,
  info: RunInfo | null,
  snapshot: StepsSnapshot,
  retryHints: RetryHintMap,
  nowMs: number,
): StepRow {
  const hasRetryHint = retryHints.has(token.id);
  const status = tokenToStatus(token, hasRetryHint);
  const role = stepStatusToRole(status);
  const glyphKey = stepStatusToGlyphKey(status);
  const elapsedMs = deriveStepElapsedMs(token, nowMs);
  const elapsed = formatStepElapsed(elapsedMs);
  const attempt = formatAttemptFor(token, snapshot);
  const note = noteForLeaf(
    token,
    snapshot.tokens,
    retryHints,
    nowMs,
    info,
    status,
  );
  return {
    id: token.id,
    kind: "leaf",
    depth,
    label: token.nodeId,
    status,
    attempt,
    elapsed,
    elapsedMs,
    note,
    role,
    glyphKey,
    tokenId: token.id,
    nodeId: token.nodeId,
  };
}

function formatAttemptFor(
  token: Token,
  snapshot: StepsSnapshot,
): string {
  // Engine retryBudgets are keyed "nodeId:label" — label typically `"fail"`.
  // Pick the first budget that matches this node id, if any.
  for (const [key, budget] of snapshot.retryBudgets) {
    if (key.startsWith(`${token.nodeId}:`)) {
      return formatAttempt(budget);
    }
  }
  return formatAttempt(undefined);
}

function noteForLeaf(
  token: Token,
  tokensById: ReadonlyMap<string, Token>,
  retryHints: RetryHintMap,
  nowMs: number,
  info: RunInfo | null,
  status: StepStatus,
): string {
  const retryHint = retryHints.get(token.id);
  if (retryHint && (token.state === "running" || token.state === "pending")) {
    const countdown = formatRetryCountdown(retryHint, nowMs);
    return `${UNICODE_GLYPHS.retry} ${countdown}`;
  }
  const upstream = upstreamNoteLabel(token, tokensById);
  if (upstream != null) return upstream;
  if (token.state === "complete" && token.result) {
    return formatEdgeNote(token.result);
  }
  if (token.state === "waiting") {
    return formatWaitingNote(
      matchingStepResult(token, info) ?? token.result,
    );
  }
  // pending / running default — suppress to avoid noise. `status`
  // parameter kept for future branch (running-no-retry could show e.g.
  // in-flight summary); today we leave it blank to match mockup §4.
  void status;
  return "";
}

function matchingStepResult(
  token: Token,
  info: RunInfo | null,
): StepResult | undefined {
  if (!info) return undefined;
  for (let i = info.steps.length - 1; i >= 0; i--) {
    const s = info.steps[i]!;
    if (s.node === token.nodeId) return s;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Permissive snapshot projector (ring-buffer tolerant)
// ---------------------------------------------------------------------------

/**
 * Fold the capped tail of engine events into a `StepsSnapshot`. Unlike
 * `replay()` in the engine, this tolerates missing `run:start` headers —
 * the ring buffer may start mid-run. Only the event types the step table
 * needs are handled; everything else is a no-op.
 *
 * Handled events:
 *   - `token:created` / `token:state` → token map
 *   - `step:start` / `step:complete`  → `running` / `complete` state
 *   - `batch:start` / `batch:item:complete` / `batch:complete` → batches
 *   - `retry:increment`               → retryBudgets
 */
export function projectStepsSnapshot(
  events: ReadonlyArray<EngineEvent>,
  info: RunInfo | null,
): StepsSnapshot {
  const tokens = new Map<string, Token>();
  const retryBudgets = new Map<string, { count: number; max: number }>();
  const batches = new Map<string, BatchState>();

  for (const ev of events) {
    switch (ev.type) {
      case "token:created": {
        const existing = tokens.get(ev.tokenId);
        if (existing) break;
        const t: Token = {
          id: ev.tokenId,
          nodeId: ev.nodeId,
          generation: ev.generation,
          state: "pending",
        };
        if (ev.parentTokenId !== undefined) t.parentTokenId = ev.parentTokenId;
        if (ev.batchId !== undefined) t.batchId = ev.batchId;
        if (ev.itemIndex !== undefined) t.itemIndex = ev.itemIndex;
        tokens.set(ev.tokenId, t);
        break;
      }
      case "token:state": {
        const t = tokens.get(ev.tokenId);
        if (!t) break;
        tokens.set(ev.tokenId, { ...t, state: ev.to });
        break;
      }
      case "step:start": {
        const t = tokens.get(ev.tokenId);
        if (!t) break;
        // Seed a partial result so elapsed math has a started_at.
        if (!t.result) {
          tokens.set(ev.tokenId, {
            ...t,
            state: "running" as TokenState,
            result: {
              node: t.nodeId,
              type: "script",
              edge: "",
              summary: "",
              started_at: ev.ts,
              completed_at: ev.ts,
              exit_code: null,
            },
          });
        } else {
          tokens.set(ev.tokenId, { ...t, state: "running" as TokenState });
        }
        break;
      }
      case "step:complete": {
        const t = tokens.get(ev.tokenId);
        if (!t) break;
        tokens.set(ev.tokenId, {
          ...t,
          state: "complete" as TokenState,
          result: ev.result,
          edge: ev.result.edge,
        });
        break;
      }
      case "retry:increment": {
        const key = `${ev.nodeId}:${ev.label}`;
        retryBudgets.set(key, { count: ev.count, max: ev.max });
        break;
      }
      case "batch:start": {
        const onItemError: ForEachItemErrorMode = ev.onItemError;
        const b: BatchState = {
          nodeId: ev.nodeId,
          expected: ev.items,
          completed: 0,
          succeeded: 0,
          failed: 0,
          onItemError,
          itemContexts: [...ev.itemContexts],
          results: Array.from({ length: ev.items }, () => undefined),
          done: false,
        };
        batches.set(ev.batchId, b);
        break;
      }
      case "batch:item:complete": {
        const b = batches.get(ev.batchId);
        if (!b) break;
        const result: BatchItemResult = {
          itemIndex: ev.itemIndex,
          ok: ev.ok,
          edge: ev.edge,
        };
        const results = [...b.results];
        results[ev.itemIndex] = result;
        const completed = b.completed + 1;
        const succeeded = ev.ok ? b.succeeded + 1 : b.succeeded;
        const failed = ev.ok ? b.failed : b.failed + 1;
        batches.set(ev.batchId, { ...b, completed, succeeded, failed, results });
        break;
      }
      case "batch:complete": {
        const b = batches.get(ev.batchId);
        if (!b) break;
        batches.set(ev.batchId, {
          ...b,
          done: true,
          status: ev.status,
          succeeded: ev.succeeded,
          failed: ev.failed,
        });
        break;
      }
      default:
        break;
    }
  }

  const completedResults: StepResult[] = info ? info.steps.slice() : [];

  return {
    tokens,
    retryBudgets,
    completedResults,
    batches,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience
// ---------------------------------------------------------------------------

export { stepStatusToLabel };
