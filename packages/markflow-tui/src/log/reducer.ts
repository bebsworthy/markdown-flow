// src/log/reducer.ts
//
// Pure reducer for the log panel (P6-T3). Owns the ring buffer of parsed
// lines, the follow/pause state machine, and cursor position.
//
// Authoritative references:
//   - docs/tui/features.md §3.5
//   - docs/tui/mockups.md §9 (paused banner)
//   - docs/tui/plans/P6-T3.md §4
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Pure in/out.

import type {
  LogLine,
  LogPanelSettings,
  LogPanelState,
  LogReducerAction,
  LogStream,
} from "./types.js";
import { LOG_RING_CAP } from "./types.js";

const INITIAL_SETTINGS: LogPanelSettings = {
  streamFilter: "both",
  wrap: false,
  timestamps: false,
};

const INITIAL_PARTIAL: Readonly<Record<LogStream, string>> = Object.freeze({
  stdout: "",
  stderr: "",
});

export const initialLogPanelState: LogPanelState = Object.freeze({
  lines: Object.freeze([]),
  dropped: 0,
  follow: true,
  cursor: 0,
  pausedAtHeadSeq: null,
  settings: INITIAL_SETTINGS,
  partialByStream: INITIAL_PARTIAL,
}) as LogPanelState;

export function logReducer(
  state: LogPanelState,
  action: LogReducerAction,
): LogPanelState {
  switch (action.type) {
    case "APPEND_LINES": {
      if (action.lines.length === 0) return state;
      const combined = [...state.lines, ...action.lines];
      const overflow = Math.max(0, combined.length - LOG_RING_CAP);
      const lines = overflow > 0 ? combined.slice(overflow) : combined;
      const dropped = state.dropped + overflow;
      const head = lines.length - 1;
      if (state.follow) {
        return {
          ...state,
          lines,
          dropped,
          cursor: Math.max(0, head),
        };
      }
      // Paused: keep cursor on its current seq if still present; else clamp.
      const prevHeadSeq = state.lines.length > 0
        ? (state.lines[state.lines.length - 1]!.seq << 0) * 0 + state.lines.length - 1
        : 0;
      void prevHeadSeq;
      const newCursor = Math.min(Math.max(0, state.cursor - overflow), Math.max(0, head));
      return {
        ...state,
        lines,
        dropped,
        cursor: newCursor,
      };
    }
    case "SET_PARTIAL": {
      if (state.partialByStream[action.stream] === action.buf) return state;
      return {
        ...state,
        partialByStream: {
          ...state.partialByStream,
          [action.stream]: action.buf,
        },
      };
    }
    case "SET_FOLLOW": {
      if (state.follow === action.follow) return state;
      if (action.follow) {
        const head = Math.max(0, state.lines.length - 1);
        return {
          ...state,
          follow: true,
          pausedAtHeadSeq: null,
          cursor: head,
        };
      }
      return {
        ...state,
        follow: false,
        pausedAtHeadSeq: headSeq(state),
      };
    }
    case "SET_WRAP": {
      if (state.settings.wrap === action.wrap) return state;
      return {
        ...state,
        settings: { ...state.settings, wrap: action.wrap },
      };
    }
    case "SET_TIMESTAMPS": {
      if (state.settings.timestamps === action.timestamps) return state;
      return {
        ...state,
        settings: { ...state.settings, timestamps: action.timestamps },
      };
    }
    case "SET_STREAM_FILTER": {
      if (state.settings.streamFilter === action.filter) return state;
      return {
        ...state,
        settings: { ...state.settings, streamFilter: action.filter },
      };
    }
    case "SCROLL_DELTA": {
      if (action.delta === 0 || state.lines.length === 0) return state;
      const head = state.lines.length - 1;
      const next = clamp(state.cursor + action.delta, 0, head);
      if (next === state.cursor) return state;
      // Any upward movement while following auto-pauses.
      if (action.delta < 0 && state.follow) {
        return {
          ...state,
          follow: false,
          pausedAtHeadSeq: headSeq(state),
          cursor: next,
        };
      }
      // Downward movement that lands on head while paused auto-resumes.
      if (action.delta > 0 && !state.follow && next === head) {
        return {
          ...state,
          follow: true,
          pausedAtHeadSeq: null,
          cursor: head,
        };
      }
      return { ...state, cursor: next };
    }
    case "SCROLL_PAGE": {
      if (state.lines.length === 0 || action.pageSize <= 0) return state;
      const delta = action.direction === "up" ? -action.pageSize : action.pageSize;
      return logReducer(state, { type: "SCROLL_DELTA", delta });
    }
    case "SCROLL_JUMP_HEAD": {
      const head = Math.max(0, state.lines.length - 1);
      if (state.follow && state.cursor === head) return state;
      return {
        ...state,
        follow: true,
        pausedAtHeadSeq: null,
        cursor: head,
      };
    }
    case "SCROLL_JUMP_TOP": {
      if (state.lines.length === 0) return state;
      const alreadyTop = state.cursor === 0 && !state.follow;
      if (alreadyTop) return state;
      return {
        ...state,
        follow: false,
        pausedAtHeadSeq: state.pausedAtHeadSeq ?? headSeq(state),
        cursor: 0,
      };
    }
    case "RESET": {
      return initialLogPanelState;
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function headSeq(state: LogPanelState): number | null {
  if (state.lines.length === 0) return null;
  // The cursor counter we track for the "N new since pause" banner is the
  // line count at pause-time, not a seq: lines may share a seq (all derive
  // from the same step:start). We reuse `pausedAtHeadSeq` as a line index.
  return state.lines.length - 1;
}

/** Count the number of lines appended since `pausedAtHeadSeq` (which stores
 *  the last line index at pause-time). */
export function linesSincePause(state: LogPanelState): number {
  if (state.follow || state.pausedAtHeadSeq === null) return 0;
  const head = state.lines.length - 1;
  return Math.max(0, head - state.pausedAtHeadSeq);
}
