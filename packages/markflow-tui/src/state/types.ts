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
// so this stays within the purity envelope.

import type { AddModalTab } from "../add-modal/types.js";

/** Which top-level area of the app is active. §5.1 "app mode" tree. */
export type Mode =
  | { readonly kind: "browsing"; readonly pane: BrowsingPane }
  | { readonly kind: "viewing"; readonly runId: string; readonly focus: ViewingFocus };

/** Sub-panes of `browsing` mode. §5.1. */
export type BrowsingPane = "workflows" | "runs";

/** Sub-panes of `viewing` mode. §5.1 / §6.3. */
export type ViewingFocus = "graph" | "detail" | "log";

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
    }
  | { readonly kind: "confirmCancel"; readonly runId: string }
  | { readonly kind: "commandPalette"; readonly query: string }
  | { readonly kind: "help" }
  // Add-workflow modal (P4-T3). The tab is the only piece of modal state
  // threaded through the reducer — all other ephemeral state (query text,
  // walker results, URL input, ingest in-flight flag, root picker) lives
  // as component-local `useState` inside <AddWorkflowModal>.
  | { readonly kind: "addWorkflow"; readonly tab: AddModalTab };

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
  | { readonly type: "MODE_OPEN_RUN"; readonly runId: string; readonly focus?: ViewingFocus }
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
  // Add-workflow modal tab toggle (P4-T3). No-op unless overlay is already
  // `addWorkflow`; see reducer.ts for the guard.
  | { readonly type: "ADD_MODAL_SET_TAB"; readonly tab: AddModalTab };
