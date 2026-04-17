// src/help/reducer.ts
//
// Local reducer for <HelpOverlay> (P7-T3). Pure.

export interface HelpLocalState {
  readonly search: string;
  readonly cursor: number;
}

export type HelpAction =
  | { readonly type: "SEARCH_SET"; readonly value: string }
  | { readonly type: "CURSOR_MOVE"; readonly delta: number }
  | { readonly type: "CURSOR_RESET" };

export const initialHelpState: HelpLocalState = {
  search: "",
  cursor: 0,
};

export function helpReducer(
  state: HelpLocalState,
  action: HelpAction,
  env: { readonly rowCount: number },
): HelpLocalState {
  const max = Math.max(0, env.rowCount - 1);
  switch (action.type) {
    case "SEARCH_SET":
      if (state.search === action.value && state.cursor === 0) return state;
      return { search: action.value, cursor: 0 };
    case "CURSOR_MOVE": {
      if (env.rowCount <= 0) {
        return state.cursor === 0 ? state : { ...state, cursor: 0 };
      }
      const next = Math.max(0, Math.min(max, state.cursor + action.delta));
      return next === state.cursor ? state : { ...state, cursor: next };
    }
    case "CURSOR_RESET":
      return state.cursor === 0 ? state : { ...state, cursor: 0 };
  }
}
