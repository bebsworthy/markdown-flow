// src/resume/reducer.ts
//
// Pure reducer for the resume wizard's local form state (focus, cursors,
// rerun set, input drafts, submit FSM).
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type {
  InputRow,
  RerunNode,
  ResumeFocus,
  ResumeFormAction,
  ResumeFormState,
} from "./types.js";

const FOCUS_ORDER: readonly ResumeFocus[] = ["rerun", "inputs", "confirm"];

export function initialResumeFormState(args: {
  readonly nodes: readonly RerunNode[];
  readonly inputs: readonly InputRow[];
}): ResumeFormState {
  const rerun = new Set<string>();
  for (const n of args.nodes) if (n.preselected) rerun.add(n.nodeId);
  const inputs: Record<string, string> = {};
  for (const r of args.inputs) inputs[r.key] = r.draft;
  return {
    focus: "rerun",
    rerunCursor: 0,
    inputsCursor: 0,
    rerun,
    inputs,
    fsm: "idle",
    error: null,
  };
}

export function resumeFormReducer(
  state: ResumeFormState,
  action: ResumeFormAction,
  env: { readonly nodeCount: number; readonly inputCount: number },
): ResumeFormState {
  if (state.fsm === "submitting") {
    // Only SUBMIT_OK / SUBMIT_FAIL are allowed mid-submit.
    if (action.type === "SUBMIT_OK" || action.type === "SUBMIT_FAIL") {
      // fall through
    } else {
      return state;
    }
  }
  switch (action.type) {
    case "FOCUS_NEXT": {
      const i = FOCUS_ORDER.indexOf(state.focus);
      const next = FOCUS_ORDER[(i + 1) % FOCUS_ORDER.length]!;
      return next === state.focus ? state : { ...state, focus: next };
    }
    case "FOCUS_PREV": {
      const i = FOCUS_ORDER.indexOf(state.focus);
      const n = FOCUS_ORDER.length;
      const prev = FOCUS_ORDER[((i - 1) % n + n) % n]!;
      return prev === state.focus ? state : { ...state, focus: prev };
    }
    case "CURSOR_MOVE": {
      const delta = Math.trunc(action.delta);
      if (delta === 0) return state;
      if (state.focus === "rerun") {
        const n = Math.max(0, env.nodeCount);
        if (n <= 0) return state;
        const next = ((state.rerunCursor + delta) % n + n) % n;
        return next === state.rerunCursor ? state : { ...state, rerunCursor: next };
      }
      if (state.focus === "inputs") {
        const n = Math.max(0, env.inputCount);
        if (n <= 0) return state;
        const next = ((state.inputsCursor + delta) % n + n) % n;
        return next === state.inputsCursor ? state : { ...state, inputsCursor: next };
      }
      // confirm focus — cursor stays where it was.
      return state;
    }
    case "RERUN_TOGGLE": {
      // No-op: the set lives on AppState; this reducer doesn't own it. Kept
      // for API symmetry; components dispatch the AppState action directly.
      return state;
    }
    case "INPUT_EDIT": {
      const current = state.inputs[action.key];
      if (current === action.value) return state;
      return {
        ...state,
        inputs: { ...state.inputs, [action.key]: action.value },
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
