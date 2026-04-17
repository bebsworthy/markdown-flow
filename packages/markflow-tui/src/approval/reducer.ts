// src/approval/reducer.ts
//
// Pure reducer for the approval modal's local form state (cursor + submit
// FSM). Component-local; not part of the top-level AppState.
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type {
  ApprovalFormAction,
  ApprovalFormState,
} from "./types.js";

/**
 * Build the initial form state given the option count. Cursor starts at 0;
 * if `options` is empty cursor stays 0.
 */
export function initialApprovalFormState(
  options: readonly string[],
): ApprovalFormState {
  // Only `options.length` is consulted; kept as a function for future
  // per-approval seeding.
  void options;
  return { cursor: 0, fsm: "idle", error: null };
}

/**
 * Pure reducer. Cursor wraps at option ends (matches `↑↓ cycle` in
 * mockups §5). `SUBMIT_START` is guarded against re-entry.
 */
export function approvalFormReducer(
  state: ApprovalFormState,
  action: ApprovalFormAction,
  optionCount: number = Number.POSITIVE_INFINITY,
): ApprovalFormState {
  switch (action.type) {
    case "CURSOR_MOVE": {
      if (state.fsm === "submitting") return state;
      const n = Number.isFinite(optionCount) ? Math.max(0, optionCount) : 0;
      if (n <= 0) return state.cursor === 0 ? state : { ...state, cursor: 0 };
      const delta = Math.trunc(action.delta);
      // Wrap. JS modulo is truncated toward zero; normalise for negatives.
      const next = ((state.cursor + delta) % n + n) % n;
      if (next === state.cursor) return state;
      return { ...state, cursor: next };
    }
    case "SUBMIT_START": {
      if (state.fsm === "submitting") return state;
      return { ...state, fsm: "submitting", error: null };
    }
    case "SUBMIT_OK": {
      if (state.fsm === "idle") return state;
      return { ...state, fsm: "idle", error: null };
    }
    case "SUBMIT_FAIL": {
      return { ...state, fsm: "error", error: action.error };
    }
  }
}
