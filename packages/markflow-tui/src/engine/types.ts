// src/engine/types.ts
//
// Types for the engine adapter (P3-T2).
//
// Authoritative references:
//   - docs/tui/plan.md §P3-T2 (lines 277-286)
//   - docs/tui/plans/P3-T2.md §5 (state slice decision)
//   - docs/tui/features.md §6.2 (data flow)
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any other I/O / rendering surface. It declares types
// only. The companion `reducer.ts` follows the same rule; `adapter.ts` is
// permitted exactly one exception for `node:path` (deterministic join).

import type {
  EngineEvent,
  RunEvent as MarkflowRunEvent,
  RunInfo,
  RunManager,
} from "markflow";

// Re-export `MarkflowRunEvent` so downstream consumers have one import point.
export type { MarkflowRunEvent };

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

/**
 * Options passed to `createEngineAdapter`.
 *
 * `runsDir` and `runManager` are mutually supportive:
 * - If `runManager` is omitted, the adapter builds one from `runsDir`.
 * - If `runManager` is provided, `runsDir` may still be required — when
 *   `runId` is present, the adapter joins `runsDir + runId` to derive the
 *   per-run directory for `tailEventLog`. Providing `runManager` alone with
 *   no `runsDir` and a `runId` is an error (see `adapter.ts::requireRunsDir`).
 */
export interface EngineAdapterOptions {
  /** Path to the `runs/` parent. Required when `runManager` is omitted. */
  readonly runsDir?: string;

  /**
   * Pre-constructed `RunManager`. If omitted, the adapter builds one from
   * `runsDir`. Provided primarily for tests that want to wrap a custom
   * `RunManager` impl.
   */
  readonly runManager?: RunManager;

  /**
   * Optional initial run id to tail. If set, the adapter starts a
   * `tailEventLog` subscription immediately. If unset, the adapter only
   * yields list events (from `runManager.watch`).
   */
  readonly runId?: string;

  /**
   * Inclusive starting seq for the per-run tail. Defaults to 0 (all events).
   * When replaying an existing run that was previously hydrated from
   * `readEventLog`, the caller passes `snapshot.lastSeq + 1` to skip what's
   * already folded.
   */
  readonly fromSeq?: number;

  /**
   * Abort signal. When fired, both the list watcher and any active per-run
   * tail unsubscribe cleanly; the adapter async iterable then returns.
   */
  readonly signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Adapter output
// ---------------------------------------------------------------------------

/** The merged yield shape from `createEngineAdapter`. */
export type EngineAdapterEvent =
  | {
      readonly kind: "list";
      /** Forwarded 1:1 from `runManager.watch`. */
      readonly event: MarkflowRunEvent;
    }
  | {
      readonly kind: "run";
      /** Which run this engine event belongs to (the active tail). */
      readonly runId: string;
      readonly event: EngineEvent;
    }
  | {
      readonly kind: "run:detached";
      /**
       * Fired when the per-run tail ends because the run reached a terminal
       * workflow event (`workflow:complete` / `workflow:error`) or the
       * adapter was aborted. Gives the reducer a hook to freeze its live
       * snapshot.
       */
      readonly runId: string;
      readonly reason: "terminal" | "swapped" | "aborted";
    };

// ---------------------------------------------------------------------------
// Engine reducer surface (separate slice from `src/state/*`)
// ---------------------------------------------------------------------------

/** Per-run projection kept live by the adapter. */
export interface LiveRunSnapshot {
  readonly runId: string;
  /** Most-recently-seen list snapshot for this run, or `null` if we only see
   *  tail events before a list event arrives. */
  readonly info: RunInfo | null;
  /** Bounded tail of engine events (see §5.4 — capped at 500 entries). */
  readonly events: readonly EngineEvent[];
  readonly lastSeq: number;
  readonly terminal: boolean;
}

/** Top-level state for the engine slice. */
export interface EngineState {
  /**
   * Ordered map of known runs (from `rm.watch`). Insertion order reflects
   * the order events arrived (initial alphabetical burst first, then live).
   */
  readonly runs: ReadonlyMap<string, RunInfo>;

  /** The currently tailed run, if any. One per adapter instance. */
  readonly activeRun: LiveRunSnapshot | null;
}

/** Actions that flow from the adapter into the engine reducer. */
export type EngineAction =
  // --- List-watcher-driven ---------------------------------------------------
  | { readonly type: "RUN_ADDED"; readonly runId: string; readonly info: RunInfo }
  | { readonly type: "RUN_UPDATED"; readonly runId: string; readonly info: RunInfo }
  | { readonly type: "RUN_REMOVED"; readonly runId: string }
  // --- Per-run tail-driven ---------------------------------------------------
  | {
      readonly type: "RUN_TAIL_EVENT";
      readonly runId: string;
      readonly event: EngineEvent;
    }
  | {
      readonly type: "RUN_TAIL_DETACHED";
      readonly runId: string;
      readonly reason: "terminal" | "swapped" | "aborted";
    }
  // --- Lifecycle ---------------------------------------------------------------
  | { readonly type: "ENGINE_RESET" };
