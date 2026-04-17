// src/runStart/reducer.ts
//
// Pure reducer for the input-prompt modal's local form state (cursor,
// per-row drafts, submit FSM) (P9-T1).
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type {
  RunInputFormAction,
  RunInputFormState,
  RunInputRow,
} from "./types.js";

export function initialRunInputFormState(
  rows: readonly RunInputRow[],
): RunInputFormState {
  return {
    rows,
    cursor: 0,
    fsm: "idle",
    error: null,
  };
}

function clampIndex(idx: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  if (idx < 0) return 0;
  if (idx > rowCount - 1) return rowCount - 1;
  return idx;
}

export function runInputFormReducer(
  state: RunInputFormState,
  action: RunInputFormAction,
): RunInputFormState {
  switch (action.type) {
    case "CURSOR_MOVE": {
      const delta = Math.trunc(action.delta);
      if (delta === 0) return state;
      const next = clampIndex(state.cursor + delta, state.rows.length);
      return next === state.cursor ? state : { ...state, cursor: next };
    }
    case "CURSOR_SET": {
      const next = clampIndex(Math.trunc(action.index), state.rows.length);
      return next === state.cursor ? state : { ...state, cursor: next };
    }
    case "SET_DRAFT": {
      let changed = false;
      const nextRows: RunInputRow[] = state.rows.map((row) => {
        if (row.key !== action.key) return row;
        if (row.draft === action.value) return row;
        changed = true;
        return { ...row, draft: action.value };
      });
      if (!changed && state.fsm !== "error") return state;
      // Soft reset of the error banner on any edit.
      const clearedFsm = state.fsm === "error" ? "idle" : state.fsm;
      const clearedError = state.fsm === "error" ? null : state.error;
      if (!changed) {
        return { ...state, fsm: clearedFsm, error: clearedError };
      }
      return {
        ...state,
        rows: nextRows,
        fsm: clearedFsm,
        error: clearedError,
      };
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
