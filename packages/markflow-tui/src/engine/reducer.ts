// src/engine/reducer.ts
//
// Pure reducer for the engine slice of markflow-tui state.
//
// Authoritative references:
//   - docs/tui/plans/P3-T2.md §5.2-§5.5
//   - docs/tui/features.md §6.2
//
// PURITY NOTE: no `ink` / `react` / `node:*` / `fs` / `path` imports. The
// companion `adapter.ts` is the only module in this slice allowed to touch
// `node:path`.

import type {
  EngineAction,
  EngineAdapterEvent,
  EngineState,
  LiveRunSnapshot,
} from "./types.js";
import type { EngineEvent } from "markflow";

/**
 * Ring-buffer cap for `activeRun.events`. Callers that need full history
 * call `readEventLog` on demand. Tuned conservatively for MVP — see
 * docs/tui/plans/P3-T2.md §5.4.
 */
export const TAIL_EVENTS_CAP = 500;

/** Empty initial engine state. */
export const initialEngineState: EngineState = {
  runs: new Map(),
  activeRun: null,
};

export function engineReducer(
  state: EngineState,
  action: EngineAction,
): EngineState {
  switch (action.type) {
    // --- List-watcher-driven ---------------------------------------------
    case "RUN_ADDED": {
      // Idempotent — the hook's re-mount pattern (§3.5) re-emits `added`
      // for existing runs; we simply accept the newest snapshot.
      const runs = new Map(state.runs);
      runs.set(action.runId, action.info);
      return { ...state, runs };
    }
    case "RUN_UPDATED": {
      // Falls through to insert if the runId is not yet known — matches
      // engine watch semantics where updates can legitimately precede the
      // consumer observing the initial `added` burst.
      const runs = new Map(state.runs);
      runs.set(action.runId, action.info);
      return { ...state, runs };
    }
    case "RUN_REMOVED": {
      if (!state.runs.has(action.runId)) return state;
      const runs = new Map(state.runs);
      runs.delete(action.runId);
      // If the active run was removed, clear the live snapshot as well.
      const activeRun =
        state.activeRun && state.activeRun.runId === action.runId
          ? null
          : state.activeRun;
      return { ...state, runs, activeRun };
    }

    // --- Per-run tail-driven ---------------------------------------------
    case "RUN_TAIL_EVENT": {
      // Ignore events for a runId that is not currently active. We establish
      // activeRun on first tail event; thereafter events for other runIds
      // are silently dropped (no cross-adapter leakage).
      const active = state.activeRun;
      if (active && active.runId !== action.runId) return state;

      const base: LiveRunSnapshot =
        active ??
        ({
          runId: action.runId,
          info: state.runs.get(action.runId) ?? null,
          events: [],
          lastSeq: -1,
          terminal: false,
        } as LiveRunSnapshot);

      const events = appendBounded(base.events, action.event);
      return {
        ...state,
        activeRun: {
          ...base,
          events,
          lastSeq: Math.max(base.lastSeq, action.event.seq),
        },
      };
    }
    case "RUN_TAIL_DETACHED": {
      const active = state.activeRun;
      if (!active || active.runId !== action.runId) return state;
      if (action.reason === "swapped") {
        // The adapter swapped out — clear the live snapshot.
        return { ...state, activeRun: null };
      }
      // "terminal" | "aborted" — keep the snapshot but flip terminal flag so
      // downstream UI can render a frozen state.
      if (active.terminal) return state;
      return { ...state, activeRun: { ...active, terminal: true } };
    }
  }
}

/**
 * Translate an `EngineAdapterEvent` into the matching `EngineAction`.
 *
 * Pure; no I/O. The adapter yields events, the hook calls this to obtain
 * the reducer action. Returning `EngineAction` (non-null) because every
 * variant has a matching action — the TypeScript compiler's exhaustiveness
 * check enforces this at build time (see the `never` at the bottom).
 */
export function toEngineAction(e: EngineAdapterEvent): EngineAction {
  switch (e.kind) {
    case "list": {
      const inner = e.event;
      switch (inner.kind) {
        case "added":
          return {
            type: "RUN_ADDED",
            runId: inner.runId,
            info: inner.snapshot,
          };
        case "updated":
          return {
            type: "RUN_UPDATED",
            runId: inner.runId,
            info: inner.snapshot,
          };
        case "removed":
          return { type: "RUN_REMOVED", runId: inner.runId };
        default:
          return exhaustive(inner);
      }
    }
    case "run":
      return {
        type: "RUN_TAIL_EVENT",
        runId: e.runId,
        event: e.event,
      };
    case "run:detached":
      return {
        type: "RUN_TAIL_DETACHED",
        runId: e.runId,
        reason: e.reason,
      };
    default:
      return exhaustive(e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appendBounded(
  events: readonly EngineEvent[],
  next: EngineEvent,
): readonly EngineEvent[] {
  if (events.length < TAIL_EVENTS_CAP) {
    return [...events, next];
  }
  // Drop oldest; keep the newest TAIL_EVENTS_CAP entries.
  return [...events.slice(events.length - TAIL_EVENTS_CAP + 1), next];
}

function exhaustive(x: never): never {
  throw new Error(
    `toEngineAction: unhandled EngineAdapterEvent variant ${JSON.stringify(x)}`,
  );
}
