// src/steps/derive.ts
//
// Pure projection helpers turning engine `Token` + `StepResult` records into
// displayable step-row fields (status cells, attempt strings, elapsed values,
// NOTE text). Mirrors `runs/derive.ts` conventions.
//
// Authoritative references:
//   - docs/tui/features.md §3.3 + §5.10
//   - docs/tui/mockups.md §4 + §6
//   - docs/tui/plans/P6-T1.md §5, §7
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` and sibling pure modules + runtime constants from theme/glyphs.

import type { StepResult, Token, TokenState } from "markflow";
import type { GlyphKey } from "../theme/glyphs.js";
import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import type { ColorRole } from "../theme/tokens.js";
import type { StepStatus, StepStatusCell } from "./types.js";

// ---------------------------------------------------------------------------
// TokenState → StepStatus synthesis (handles the "failed" + "retrying" edges)
// ---------------------------------------------------------------------------

/**
 * Derive a `StepStatus` from a `Token`. A complete token whose result edge
 * starts with `"fail"` (e.g. `"fail"` or `"fail:max"`) is mapped to
 * `"failed"` — which is NOT a real `TokenState` but is the display status
 * mockups §6 demands.
 *
 * `hasRetryHint` layers `"retrying"` on top of running/pending tokens when
 * the caller has a live retry hint for this token.
 */
export function tokenToStatus(
  token: Token,
  hasRetryHint: boolean = false,
): StepStatus {
  if (hasRetryHint && (token.state === "running" || token.state === "pending")) {
    return "retrying";
  }
  if (token.state === "complete") {
    const edge = token.result?.edge ?? "";
    if (edge.startsWith("fail")) return "failed";
    return "complete";
  }
  return token.state as StepStatus;
}

// ---------------------------------------------------------------------------
// Status → role / glyph / label
// ---------------------------------------------------------------------------

export function stepStatusToRole(status: StepStatus): ColorRole {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "complete":
      return "complete";
    case "skipped":
      return "skipped";
    case "waiting":
      return "waiting";
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function stepStatusToGlyphKey(status: StepStatus): GlyphKey {
  switch (status) {
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
      return "retry";
    case "failed":
      return "fail";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * User-facing status label. Engine `"complete"` renders as `"ok"`, `"failed"`
 * as `"failed"` (for clarity in mockups §6). Lowercase throughout per §5.10.
 */
export function stepStatusToLabel(status: StepStatus): string {
  switch (status) {
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
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// StatusCell builder
// ---------------------------------------------------------------------------

export function toStepStatusCell(status: StepStatus): StepStatusCell {
  const role = stepStatusToRole(status);
  const glyphKey = stepStatusToGlyphKey(status);
  const label = stepStatusToLabel(status);
  return {
    glyph: UNICODE_GLYPHS[glyphKey],
    glyphKey,
    label,
    role,
  };
}

// ---------------------------------------------------------------------------
// Attempt / elapsed formatters
// ---------------------------------------------------------------------------

const EM_DASH = "\u2014";

/**
 * Format the ATTEMPT column value. Engine `retryBudgets` are `{count, max}`
 * — `count` is the number of retries already consumed, so the current
 * attempt is `count + 1` of `max + 1` total attempts. When there is no
 * budget for this node, returns `"—"`.
 */
export function formatAttempt(
  budget: { count: number; max: number } | undefined,
): string {
  if (!budget) return EM_DASH;
  const current = budget.count + 1;
  const total = budget.max + 1;
  return `${current}/${total}`;
}

/**
 * Elapsed-ms for a token. Complete tokens use `completed - started`; running
 * tokens use `now - started`; pending/waiting/skipped return 0. Malformed
 * ISO → 0.
 */
export function deriveStepElapsedMs(
  token: Token,
  nowMs: number,
): number {
  const result = token.result;
  if (token.state === "complete" && result) {
    const s = Date.parse(result.started_at);
    const e = Date.parse(result.completed_at);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
    const diff = e - s;
    return diff < 0 ? 0 : diff;
  }
  if (token.state === "running" && result) {
    const s = Date.parse(result.started_at);
    if (!Number.isFinite(s)) return 0;
    const diff = nowMs - s;
    return diff < 0 ? 0 : diff;
  }
  return 0;
}

/**
 * Format an elapsed-ms value as a compact duration.
 *   0              → "—"
 *   < 60s          → "Ns"
 *   < 1h           → "NmSSs"
 *   < 24h          → "NhMm"
 *   >= 24h         → "Nd Hh"
 * Negative or NaN → "—".
 */
export function formatStepElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return EM_DASH;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  if (totalSeconds < 86400) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}h${m.toString().padStart(2, "0")}m`;
  }
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

// ---------------------------------------------------------------------------
// Edge / note helpers
// ---------------------------------------------------------------------------

/**
 * Format a terminal token's NOTE text from its `StepResult.edge`.
 *   "fail" / "fail:max"     → "retries exhausted · edge: fail:max" style
 *   "success" / "" / "next" → "→ next"
 *   any other label         → "→ <edge>"
 */
export function formatEdgeNote(result: StepResult): string {
  const edge = result.edge ?? "";
  if (edge === "fail:max") {
    const exit = result.exit_code != null ? ` (exit ${result.exit_code})` : "";
    return `retries exhausted · edge: fail:max${exit}`;
  }
  if (edge === "fail") {
    const exit = result.exit_code != null ? ` (exit ${result.exit_code})` : "";
    return `edge: fail${exit}`;
  }
  if (edge === "" || edge === "next" || edge === "success" || edge === "ok") {
    return `${UNICODE_GLYPHS.arrow} next`;
  }
  return `${UNICODE_GLYPHS.arrow} ${edge}`;
}

/** Pretty-print a waiting token's NOTE using the `StepResult.summary`, if any. */
export function formatWaitingNote(result: StepResult | undefined): string {
  if (!result) return "waiting";
  const summary = result.summary?.trim();
  if (summary) return `"${summary}"`;
  return "waiting";
}

// Re-exports referenced elsewhere
export type { TokenState };
