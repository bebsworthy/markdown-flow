// src/events/reducer.ts
//
// Pure reducer for the Events tab (P6-T4). Mirrors the log reducer's
// follow/pause semantics.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §4
//
// PURITY NOTE: no ink/react/node:* imports.

import type {
  EventsFilter,
  EventsPanelSettings,
  EventsPanelState,
  EventsReducerAction,
} from "./types.js";

const INITIAL_SETTINGS: EventsPanelSettings = { follow: true };

const INITIAL_FILTER: EventsFilter = {
  kinds: "all",
  nodeId: null,
  search: "",
};

export const initialEventsPanelState: EventsPanelState = Object.freeze({
  events: Object.freeze([]),
  filter: INITIAL_FILTER,
  settings: INITIAL_SETTINGS,
  cursor: 0,
  pausedAtHeadFilteredIdx: null,
  searchOpen: false,
  searchDraft: "",
}) as EventsPanelState;

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function eventsReducer(
  state: EventsPanelState,
  action: EventsReducerAction,
): EventsPanelState {
  switch (action.type) {
    case "SET_EVENTS": {
      if (action.events === state.events) return state;
      const head = Math.max(0, action.events.length - 1);
      if (state.settings.follow) {
        return {
          ...state,
          events: action.events,
          cursor: head,
        };
      }
      const cursor = clamp(state.cursor, 0, head);
      return { ...state, events: action.events, cursor };
    }
    case "SET_FILTER_KINDS":
      if (state.filter.kinds === action.kinds) return state;
      return { ...state, filter: { ...state.filter, kinds: action.kinds } };
    case "SET_NODE_FILTER":
      if (state.filter.nodeId === action.nodeId) return state;
      return { ...state, filter: { ...state.filter, nodeId: action.nodeId } };
    case "SET_SEARCH":
      if (state.filter.search === action.search) return state;
      return { ...state, filter: { ...state.filter, search: action.search } };
    case "OPEN_SEARCH":
      if (state.searchOpen) return state;
      return { ...state, searchOpen: true, searchDraft: state.filter.search };
    case "CLOSE_SEARCH": {
      if (!state.searchOpen && !action.commit) return state;
      if (action.commit) {
        return {
          ...state,
          searchOpen: false,
          filter: { ...state.filter, search: state.searchDraft },
        };
      }
      return { ...state, searchOpen: false, searchDraft: state.filter.search };
    }
    case "SET_SEARCH_DRAFT":
      if (state.searchDraft === action.draft) return state;
      return { ...state, searchDraft: action.draft };
    case "TOGGLE_FOLLOW": {
      if (state.settings.follow) {
        return {
          ...state,
          settings: { ...state.settings, follow: false },
          pausedAtHeadFilteredIdx: Math.max(0, state.events.length - 1),
        };
      }
      const head = Math.max(0, state.events.length - 1);
      return {
        ...state,
        settings: { ...state.settings, follow: true },
        pausedAtHeadFilteredIdx: null,
        cursor: head,
      };
    }
    case "SCROLL_DELTA": {
      if (action.delta === 0 || state.events.length === 0) return state;
      const head = state.events.length - 1;
      const next = clamp(state.cursor + action.delta, 0, head);
      if (next === state.cursor) return state;
      if (action.delta < 0 && state.settings.follow) {
        return {
          ...state,
          settings: { ...state.settings, follow: false },
          pausedAtHeadFilteredIdx: state.events.length - 1,
          cursor: next,
        };
      }
      if (action.delta > 0 && !state.settings.follow && next === head) {
        return {
          ...state,
          settings: { ...state.settings, follow: true },
          pausedAtHeadFilteredIdx: null,
          cursor: head,
        };
      }
      return { ...state, cursor: next };
    }
    case "SCROLL_PAGE": {
      if (state.events.length === 0 || action.pageSize <= 0) return state;
      const delta =
        action.direction === "up" ? -action.pageSize : action.pageSize;
      return eventsReducer(state, { type: "SCROLL_DELTA", delta });
    }
    case "SCROLL_JUMP_HEAD": {
      const head = Math.max(0, state.events.length - 1);
      if (state.settings.follow && state.cursor === head) return state;
      return {
        ...state,
        settings: { ...state.settings, follow: true },
        pausedAtHeadFilteredIdx: null,
        cursor: head,
      };
    }
    case "SCROLL_JUMP_TOP": {
      if (state.events.length === 0) return state;
      if (!state.settings.follow && state.cursor === 0) return state;
      return {
        ...state,
        settings: { ...state.settings, follow: false },
        pausedAtHeadFilteredIdx:
          state.pausedAtHeadFilteredIdx ??
          Math.max(0, state.events.length - 1),
        cursor: 0,
      };
    }
    case "RESET":
      return initialEventsPanelState;
  }
}

/** Count events appended since pause (relative to `pausedAtHeadFilteredIdx`). */
export function eventsSincePause(state: EventsPanelState): number {
  if (state.settings.follow || state.pausedAtHeadFilteredIdx === null) return 0;
  const head = state.events.length - 1;
  return Math.max(0, head - state.pausedAtHeadFilteredIdx);
}
