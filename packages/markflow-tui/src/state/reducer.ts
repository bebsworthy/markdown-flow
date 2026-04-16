// src/state/reducer.ts
//
// Pure reducer for the markflow-tui app state.
//
// Authoritative references: features.md §5.1, §6.2, §6.3.
//
// =============================================================================
// FSM graph (mirrors features.md §5.1 tree verbatim).
// =============================================================================
//
//   ┌─ app mode ─────────────────────────────────────────────────┐
//   │  browsing                                                  │
//   │    ├── workflow-browser  (F1 / 1)                          │
//   │    └── run-list          (F2 / 2)                          │
//   │  viewing-run                                               │
//   │    ├── graph-pane        (focus 3)                         │
//   │    ├── detail-pane       (focus 4)                         │
//   │    └── log-pane          (focus 5)                         │
//   │  overlays (modal; trap focus; esc closes)                  │
//   │    ├── approval-modal                                      │
//   │    ├── resume-wizard                                       │
//   │    ├── command-palette   (:)                               │
//   │    ├── help-overlay      (?)                               │
//   │    └── confirm-cancel                                      │
//   └────────────────────────────────────────────────────────────┘
//
// Transitions (all triggered by Actions — see types.ts):
//
//   browsing.workflows ──MODE_SHOW_RUNS──▶ browsing.runs
//   browsing.runs      ──MODE_SHOW_WORKFLOWS──▶ browsing.workflows
//   browsing.*         ──MODE_OPEN_RUN(runId)──▶ viewing(runId).graph
//   viewing.*          ──MODE_CLOSE_RUN──▶ browsing.runs
//   viewing.graph      ──FOCUS_VIEWING_PANE(detail)──▶ viewing.detail
//   viewing.detail     ──FOCUS_VIEWING_PANE(log)──▶ viewing.log
//   viewing.log        ──FOCUS_VIEWING_PANE(graph)──▶ viewing.graph
//   browsing.workflows ──FOCUS_BROWSING_PANE(runs)──▶ browsing.runs
//   browsing.runs      ──FOCUS_BROWSING_PANE(workflows)──▶ browsing.workflows
//   *                  ──OVERLAY_OPEN(overlay)──▶ * + overlay set
//   * + overlay        ──OVERLAY_CLOSE──▶ * + overlay cleared
//
// Overlay-internal transitions (no mode change):
//   overlay=approval(idle) ──APPROVAL_SUBMIT──▶ overlay=approval(submitting)
//   overlay=commandPalette ──COMMAND_PALETTE_QUERY──▶ overlay=commandPalette(query=…)
//   overlay=resumeWizard   ──RESUME_WIZARD_TOGGLE_RERUN──▶ rerun ± nodeId
//   overlay=resumeWizard   ──RESUME_WIZARD_SET_INPUT──▶ inputs[k]=v
//
// Cursor / filter transitions (no mode change):
//   *                  ──SELECT_WORKFLOW(id)──▶ state.selectedWorkflowId=id
//   *                  ──SELECT_RUN(id)──▶ state.selectedRunId=id
//   *                  ──FILTER_SET(v)──▶ state.filter=v
//   *                  ──FILTER_CLEAR──▶ state.filter=""
//
// =============================================================================

import type { Action, AppState, BrowsingPane, ViewingFocus } from "./types.js";

/** Initial state — app starts on the workflow browser with no overlay. */
export const initialAppState: AppState = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: null,
  filter: "",
  selectedWorkflowId: null,
  selectedRunId: null,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    // --- Mode transitions --------------------------------------------------
    case "MODE_SHOW_WORKFLOWS":
      return withMode(state, { kind: "browsing", pane: "workflows" });
    case "MODE_SHOW_RUNS":
      return withMode(state, { kind: "browsing", pane: "runs" });
    case "MODE_OPEN_RUN":
      return {
        ...state,
        mode: {
          kind: "viewing",
          runId: action.runId,
          focus: action.focus ?? "graph",
        },
        selectedRunId: action.runId,
        filter: "",
      };
    case "MODE_CLOSE_RUN":
      return withMode(state, { kind: "browsing", pane: "runs" });

    // --- Focus transitions -------------------------------------------------
    case "FOCUS_BROWSING_PANE":
      return focusBrowsing(state, action.pane);
    case "FOCUS_VIEWING_PANE":
      return focusViewing(state, action.focus);

    // --- Selection ---------------------------------------------------------
    case "SELECT_WORKFLOW":
      return { ...state, selectedWorkflowId: action.workflowId };
    case "SELECT_RUN":
      return { ...state, selectedRunId: action.runId };

    // --- Filter ------------------------------------------------------------
    case "FILTER_SET":
      return { ...state, filter: action.value };
    case "FILTER_CLEAR":
      return state.filter === "" ? state : { ...state, filter: "" };

    // --- Overlay lifecycle -------------------------------------------------
    case "OVERLAY_OPEN":
      return { ...state, overlay: action.overlay };
    case "OVERLAY_CLOSE":
      return state.overlay === null ? state : { ...state, overlay: null };

    // --- Overlay-specific updates -----------------------------------------
    case "APPROVAL_SUBMIT":
      return updateApproval(state);
    case "COMMAND_PALETTE_QUERY":
      return updatePaletteQuery(state, action.query);
    case "RESUME_WIZARD_TOGGLE_RERUN":
      return toggleResumeRerun(state, action.nodeId);
    case "RESUME_WIZARD_SET_INPUT":
      return setResumeInput(state, action.key, action.value);
  }
}

// ---------------------------------------------------------------------------
// Helpers — each returns a new state object (never mutates `state`).
// ---------------------------------------------------------------------------

function withMode(state: AppState, mode: AppState["mode"]): AppState {
  return { ...state, mode, filter: "" };
}

function focusBrowsing(state: AppState, pane: BrowsingPane): AppState {
  if (state.mode.kind !== "browsing") return state;
  if (state.mode.pane === pane) return state;
  return { ...state, mode: { kind: "browsing", pane }, filter: "" };
}

function focusViewing(state: AppState, focus: ViewingFocus): AppState {
  if (state.mode.kind !== "viewing") return state;
  if (state.mode.focus === focus) return state;
  return { ...state, mode: { ...state.mode, focus } };
}

function updateApproval(state: AppState): AppState {
  const ov = state.overlay;
  if (!ov || ov.kind !== "approval") return state;
  if (ov.state === "submitting") return state;
  return { ...state, overlay: { ...ov, state: "submitting" } };
}

function updatePaletteQuery(state: AppState, query: string): AppState {
  const ov = state.overlay;
  if (!ov || ov.kind !== "commandPalette") return state;
  return { ...state, overlay: { ...ov, query } };
}

function toggleResumeRerun(state: AppState, nodeId: string): AppState {
  const ov = state.overlay;
  if (!ov || ov.kind !== "resumeWizard") return state;
  const next = new Set(ov.rerun);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return { ...state, overlay: { ...ov, rerun: next } };
}

function setResumeInput(state: AppState, key: string, value: string): AppState {
  const ov = state.overlay;
  if (!ov || ov.kind !== "resumeWizard") return state;
  return {
    ...state,
    overlay: { ...ov, inputs: { ...ov.inputs, [key]: value } },
  };
}
