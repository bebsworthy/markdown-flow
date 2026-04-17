// src/steps/retry.ts
//
// Retry-hint tracking + countdown formatter. The engine's `replay()` treats
// `step:retry` as a no-op for snapshot state (see
// `packages/markflow/src/core/replay.ts` line 103) — so the snapshot alone
// cannot drive `↻ retrying in Ns` rendering. Instead, we fold the raw
// engine event tail (capped at 500 on `EngineState.activeRun.events`) into
// a `RetryHintMap` keyed by tokenId. `step:start` / `step:complete` clear
// the hint for the matching token.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §6
//   - docs/tui/features.md §3.3
//
// PURITY NOTE: no ink/react/node:* imports.

import type { EngineEvent } from "markflow";
import type { RetryHint } from "./types.js";

// ---------------------------------------------------------------------------
// Map type alias
// ---------------------------------------------------------------------------

export type RetryHintMap = ReadonlyMap<string, RetryHint>;

export const EMPTY_RETRY_HINTS: RetryHintMap = new Map();

// ---------------------------------------------------------------------------
// Pure reducer over a single event
// ---------------------------------------------------------------------------

/**
 * Fold one event into the `RetryHintMap`. Pure: returns the same reference
 * when the event does not change hint state.
 */
export function applyRetryEvent(
  hints: RetryHintMap,
  event: EngineEvent,
): RetryHintMap {
  switch (event.type) {
    case "step:retry": {
      const next = new Map(hints);
      next.set(event.tokenId, {
        tokenId: event.tokenId,
        nodeId: event.nodeId,
        attempt: event.attempt,
        scheduledAtMs: Date.parse(event.ts),
        delayMs: event.delayMs,
        reason: event.reason,
      });
      return next;
    }
    case "step:start":
    case "step:complete": {
      if (!hints.has(event.tokenId)) return hints;
      const next = new Map(hints);
      next.delete(event.tokenId);
      return next;
    }
    default:
      return hints;
  }
}

/**
 * Fold an ordered event array into a `RetryHintMap`.
 */
export function buildRetryHints(
  events: ReadonlyArray<EngineEvent>,
): RetryHintMap {
  let hints: RetryHintMap = EMPTY_RETRY_HINTS;
  for (const e of events) hints = applyRetryEvent(hints, e);
  return hints;
}

// ---------------------------------------------------------------------------
// Countdown formatter
// ---------------------------------------------------------------------------

/**
 * Render the retry-countdown string for a single hint at `nowMs`.
 * - remaining > 0   → "retrying in 3.2s"
 * - remaining <= 0  → "retrying in 0.0s" (clamped)
 * The `↻` glyph prefix is added by the caller (the tree/aggregate column
 * derivation), so this stays theme-free.
 */
export function formatRetryCountdown(
  hint: RetryHint,
  nowMs: number,
): string {
  const endsAt = hint.scheduledAtMs + hint.delayMs;
  const remainingMs = endsAt - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "retrying in 0.0s";
  }
  const seconds = remainingMs / 1000;
  return `retrying in ${seconds.toFixed(1)}s`;
}
