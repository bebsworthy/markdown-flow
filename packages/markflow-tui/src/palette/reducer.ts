// src/palette/reducer.ts
//
// Local reducer for the palette modal (P7-T3). Pure.

import type { PaletteAction, PaletteState } from "./types.js";

export const initialPaletteState: PaletteState = {
  cursor: 0,
  fsm: "idle",
  error: null,
};

export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
  env: { readonly matchCount: number },
): PaletteState {
  const max = Math.max(0, env.matchCount - 1);
  switch (action.type) {
    case "CURSOR_MOVE": {
      if (env.matchCount <= 0) {
        return state.cursor === 0 ? state : { ...state, cursor: 0 };
      }
      const next = Math.max(0, Math.min(max, state.cursor + action.delta));
      return next === state.cursor ? state : { ...state, cursor: next };
    }
    case "CURSOR_RESET_TO_FIRST":
      return state.cursor === 0 ? state : { ...state, cursor: 0 };
    case "RUN_START":
      if (state.fsm === "running") return state;
      return { ...state, fsm: "running", error: null };
    case "RUN_OK":
      return { ...state, fsm: "idle", error: null };
    case "RUN_FAIL":
      return { ...state, fsm: "error", error: action.error };
  }
}
