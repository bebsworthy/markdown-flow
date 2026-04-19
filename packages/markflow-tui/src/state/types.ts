// src/state/types.ts
//
// Core state types for the markflow-tui reducer.
//
// Authoritative references:
//   - features.md §5.1 (Information architecture)
//   - features.md §6.2 (Data flow + reducer/store)
//   - features.md §6.3 (Mode FSM sketch)
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any other I/O / rendering surface. It declares types
// only; the companion `reducer.ts` must honour the same constraint.
//
// The `AddModalTab` import from `../add-modal/types.js` is type-only and
// `../add-modal/types.ts` is itself a pure module (no runtime exports),
// so this stays within the purity envelope. The same applies to the
// `RunsSortState` import from `../runs/types.js` (P5-T1).

import type { AddModalTab } from "../add-modal/types.js";
import type {
  RunsArchivePolicy,
  RunsFilterState,
  RunsSortState,
} from "../runs/types.js";
import type { RunInputRow } from "../runStart/types.js";

/** Which top-level area of the app is active. §5.1 "app mode" tree. */
export type Mode =
  | { readonly kind: "browsing"; readonly pane: BrowsingPane }
  | { readonly kind: "viewing"; readonly runId: string; readonly focus: ViewingFocus; readonly runsDir: string };

/** Sub-panes of `browsing` mode. §5.1. */
export type BrowsingPane = "workflows" | "runs";

/** Sub-panes of `viewing` mode. §5.1 / §6.3. Widened in P6-T4 to include
 *  the Events tab — the raw `EngineEvent` stream for the selected run. */
export type ViewingFocus = "graph" | "detail" | "log" | "events";

/**
 * Focus is the keyboard target **within** the current Mode.
 * In `browsing` mode it mirrors `Mode.pane`; in `viewing` mode it mirrors
 * `Mode.focus`. Modelled as a derived alias so components can keep one
 * reference regardless of which mode is active. §5.1 "focus N" numbering.
 */
export type Focus = BrowsingPane | ViewingFocus;

/**
 * Overlay sum type. §6.3 sketch — preserved verbatim except that each
 * variant is `readonly` to match reducer immutability.
 *
 * `approval.state` is the confirmation sub-FSM from features.md §3.6
 * ("idle → confirming/committing → done"). The reducer only handles the
 * `idle → submitting` transition; the engine adapter (P3-T2) will later
 * dispatch the terminal action.
 */
export type Overlay =
  | {
      readonly kind: "approval";
      readonly runId: string;
      readonly nodeId: string;
      readonly state: "idle" | "submitting";
    }
  | {
      readonly kind: "resumeWizard";
      readonly runId: string;
      readonly rerun: ReadonlySet<string>;
      readonly inputs: Readonly<Record<string, string>>;
      readonly state: "idle" | "submitting";
    }
  | { readonly kind: "confirmCancel"; readonly runId: string }
  | { readonly kind: "commandPalette"; readonly query: string }
  | { readonly kind: "help" }
  // Add-workflow modal (P4-T3). The tab is the only piece of modal state
  // threaded through the reducer — all other ephemeral state (query text,
  // walker results, URL input, ingest in-flight flag, root picker) lives
  // as component-local `useState` inside <AddWorkflowModal>.
  | { readonly kind: "addWorkflow"; readonly tab: AddModalTab }
  // Input-prompt modal (P9-T1). Opened from browser `r`, runs-table `r`
  // on a terminal row, or `:run <workflow>` in the palette when the
  // resolved workflow declares required inputs. Row drafts live inside
  // the modal's component-local reducer — see docs/tui/plans/P9-T1.md
  // §6 D2. This overlay variant carries only the seed snapshot + submit
  // FSM so the reducer stays thin.
  | {
      readonly kind: "runInput";
      readonly workflowId: string;
      readonly sourceFile: string;
      readonly workspaceDir: string;
      readonly runsDir: string;
      readonly workflowName: string;
      readonly seedRows: readonly RunInputRow[];
      readonly state: "idle" | "submitting";
    };

/**
 * Top-level app state. §6.2 "single source of truth".
 *
 * - `mode` — where the user is.
 * - `overlay` — active modal, if any; `null` means no modal.
 * - `filter` — free-text filter for whichever list the current mode owns
 *   (workflows list in `browsing.workflows`; runs list in `browsing.runs`).
 * - `selectedWorkflowId` / `selectedRunId` — persistent cursors, preserved
 *   across mode switches so returning to a list restores the caret.
 *
 * Engine-derived state (tokens, snapshot, batches) is **not** stored here;
 * that lands in P3-T2 via an engine adapter that keeps snapshots in a
 * separate slice.
 */
export interface AppState {
  readonly mode: Mode;
  readonly overlay: Overlay | null;
  readonly filter: string;
  readonly selectedWorkflowId: string | null;
  readonly selectedRunId: string | null;
  /**
   * Current sort for the runs table (P5-T1). `key` cycles via the `s`
   * binding (`RUNS_SORT_CYCLE`); `direction` stays `"desc"` for now —
   * see docs/tui/plans/P5-T1.md §3.4 for the rationale.
   */
  readonly runsSort: RunsSortState;
  /**
   * Runs-mode `/` filter bar state (P5-T2). Distinct from the legacy
   * global `filter: string` field above which is used by the workflow
   * browser only. See docs/tui/plans/P5-T2.md §2.5 for the compat rule.
   */
  readonly runsFilter: RunsFilterState;
  /**
   * Archive-toggle policy for the runs table (P5-T2). `shown === false`
   * hides completions older than 24h + failures older than 7d. `a` flips
   * `shown`. Thresholds default to `RUNS_ARCHIVE_DEFAULTS`.
   */
  readonly runsArchive: RunsArchivePolicy;
  /**
   * Index into the sorted-filtered-archived runs row list (P5-T3). Always
   * non-negative; the upper bound is enforced at the component layer
   * (the reducer does not know `rows.length`). Paired with `selectedRunId`
   * which stores the logical run-id the bottom pane / RUN mode follows.
   * See docs/tui/plans/P5-T3.md §2.
   */
  readonly runsCursor: number;
  /**
   * Currently-selected step-row id in `viewing.*` mode (P6-T2). Either a
   * token id (for a leaf row) or `"batch:<batchId>"` (for a forEach
   * aggregate). `null` when nothing is explicitly selected — the detail
   * panel view layer falls back to the first step row so the mockup
   * §1 / §4 default renders.
   *
   * Cleared on `MODE_CLOSE_RUN`; reset to `null` on `MODE_OPEN_RUN` (no
   * carry-over across runs). See docs/tui/plans/P6-T2.md §4.
   */
  readonly selectedStepId: string | null;
}

/**
 * Action discriminated union. Every transition documented in §5.1 has
 * exactly one action that produces it. See `reducer.ts` header for the
 * full FSM graph.
 */
export type Action =
  // --- Mode transitions (top-level) ---------------------------------------
  | { readonly type: "MODE_SHOW_WORKFLOWS" }
  | { readonly type: "MODE_SHOW_RUNS" }
  | { readonly type: "MODE_OPEN_RUN"; readonly runId: string; readonly runsDir: string; readonly focus?: ViewingFocus }
  | { readonly type: "MODE_CLOSE_RUN" }
  // --- Focus transitions (within a mode) ----------------------------------
  | { readonly type: "FOCUS_BROWSING_PANE"; readonly pane: BrowsingPane }
  | { readonly type: "FOCUS_VIEWING_PANE"; readonly focus: ViewingFocus }
  // --- Selection (cursor movement inside a list) --------------------------
  | { readonly type: "SELECT_WORKFLOW"; readonly workflowId: string | null }
  | { readonly type: "SELECT_RUN"; readonly runId: string | null }
  // --- Filter input --------------------------------------------------------
  | { readonly type: "FILTER_SET"; readonly value: string }
  | { readonly type: "FILTER_CLEAR" }
  // --- Overlay lifecycle ---------------------------------------------------
  | { readonly type: "OVERLAY_OPEN"; readonly overlay: Overlay }
  | { readonly type: "OVERLAY_CLOSE" }
  // --- Overlay-specific updates (small scope for P3-T1) --------------------
  | { readonly type: "APPROVAL_SUBMIT" } // idle → submitting
  | { readonly type: "COMMAND_PALETTE_QUERY"; readonly query: string }
  | {
      readonly type: "RESUME_WIZARD_TOGGLE_RERUN";
      readonly nodeId: string;
    }
  | {
      readonly type: "RESUME_WIZARD_SET_INPUT";
      readonly key: string;
      readonly value: string;
    }
  // Resume wizard submit-gate (P7-T2). `SUBMIT_START` flips
  // `overlay.state` to `"submitting"` (guards double-submit);
  // `SUBMIT_DONE` closes the overlay unconditionally.
  | { readonly type: "RESUME_WIZARD_SUBMIT_START" }
  | { readonly type: "RESUME_WIZARD_SUBMIT_DONE" }
  // Add-workflow modal tab toggle (P4-T3). No-op unless overlay is already
  // `addWorkflow`; see reducer.ts for the guard.
  | { readonly type: "ADD_MODAL_SET_TAB"; readonly tab: AddModalTab }
  // Runs-table sort cycle (P5-T1). Advances `runsSort.key` through the
  // documented order (attention → started → ended → elapsed → status →
  // workflow → id → attention). Keeps direction at "desc".
  | { readonly type: "RUNS_SORT_CYCLE" }
  // Runs-table filter bar actions (P5-T2). `OPEN` shows the bar and
  // seeds `draft` from `applied.raw`; `INPUT` updates the draft only
  // (no reparse); `APPLY` parses + closes; `CLEAR` resets both draft
  // and applied; `CLOSE` hides without clearing.
  | { readonly type: "RUNS_FILTER_OPEN" }
  | { readonly type: "RUNS_FILTER_CLOSE" }
  | { readonly type: "RUNS_FILTER_INPUT"; readonly value: string }
  | { readonly type: "RUNS_FILTER_APPLY" }
  | { readonly type: "RUNS_FILTER_CLEAR" }
  // Runs-table archive toggle (P5-T2). Flips `runsArchive.shown`.
  | { readonly type: "RUNS_ARCHIVE_TOGGLE" }
  // Runs-table cursor / selection actions (P5-T3). See
  // docs/tui/plans/P5-T3.md §2.4 for payload rationale.
  | { readonly type: "RUNS_CURSOR_MOVE"; readonly delta: number; readonly rowCount: number }
  | { readonly type: "RUNS_CURSOR_JUMP"; readonly index: number }
  | { readonly type: "RUNS_CURSOR_HOME" }
  | { readonly type: "RUNS_CURSOR_END"; readonly rowCount: number }
  | {
      readonly type: "RUNS_CURSOR_PAGE";
      readonly direction: "up" | "down";
      readonly pageSize: number;
      readonly rowCount: number;
    }
  | { readonly type: "RUNS_SELECT"; readonly runId: string | null }
  // Step-row selection for the detail panel (P6-T2). See docs/tui/plans/
  // P6-T2.md §4 for reducer behaviour. `STEP_CURSOR_MOVE` is wired as a
  // no-op placeholder kept for catalogue symmetry with RUNS_CURSOR_MOVE;
  // row-aware cursor logic lands with a later Phase-6 task.
  | { readonly type: "SELECT_STEP"; readonly stepId: string | null }
  | { readonly type: "STEP_CURSOR_MOVE"; readonly delta: number }
  // Run-input modal submit FSM (P9-T1). `SUBMIT_START` flips
  // `overlay.state` to `"submitting"`; `SUBMIT_DONE` closes the overlay
  // unconditionally. Per-row draft edits live in the modal's local
  // reducer (§6 D2), so there is no `SET_DRAFT` at the app level.
  | { readonly type: "RUN_INPUT_SUBMIT_START" }
  | { readonly type: "RUN_INPUT_SUBMIT_DONE" };
