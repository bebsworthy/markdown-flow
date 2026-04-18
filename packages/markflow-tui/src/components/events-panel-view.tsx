// src/components/events-panel-view.tsx
//
// Owner for the Events tab (P6-T4). Holds the events reducer, merges the
// in-memory ring with the on-disk event log, and owns keybindings.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §5 / §7 D3 / D7 / D8

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useInput } from "ink";
import type { EngineEvent } from "markflow";
import type { EngineState } from "../engine/types.js";
import {
  deriveEventsModel,
  eventsReducer,
  initialEventsPanelState,
  mergeEventSources,
} from "../events/index.js";
import type { EventKindGroup, EventsReducerAction } from "../events/types.js";
import { EventsPanel } from "./events-panel.js";

export interface EventsPanelViewProps {
  readonly runsDir: string | null;
  readonly runId: string;
  readonly engineState: EngineState;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  /** True when this pane is the active (visible) tab. Keybindings are
   *  suppressed when inactive so hidden panes don't steal input. */
  readonly active?: boolean;
  /** Test seam — reads persisted events for a terminal run. Defaults to
   *  `readEventLog` from `markflow`. When `runsDir` is null this seam is
   *  skipped entirely. */
  readonly eventLogReader?: (
    runDir: string,
  ) => Promise<ReadonlyArray<EngineEvent>>;
}

export interface EventsPaneStatus {
  readonly isFollowing: boolean;
  readonly isMounted: boolean;
  readonly searchOpen: boolean;
}

const DEFAULT_STATUS: EventsPaneStatus = {
  isFollowing: false,
  isMounted: false,
  searchOpen: false,
};

export const EventsPaneStatusContext =
  createContext<EventsPaneStatus>(DEFAULT_STATUS);

export function useEventsPaneStatus(): EventsPaneStatus {
  return useContext(EventsPaneStatusContext);
}

// Cycle order for the `k` kind-group filter. Mirrors plan.md §7 D10.
const KIND_CYCLE: ReadonlyArray<"all" | ReadonlyArray<EventKindGroup>> = [
  "all",
  ["step"],
  ["retry"],
  ["step", "retry"],
  ["route"],
  ["batch"],
];

function cycleKinds(
  current: "all" | ReadonlySet<EventKindGroup>,
): "all" | ReadonlySet<EventKindGroup> {
  // Find current index by structural compare; default to 0.
  const idx = KIND_CYCLE.findIndex((c) => {
    if (c === "all") return current === "all";
    if (current === "all") return false;
    if (c.length !== current.size) return false;
    return c.every((g) => current.has(g));
  });
  const next = KIND_CYCLE[(idx + 1) % KIND_CYCLE.length]!;
  return next === "all" ? "all" : new Set(next);
}

function EventsPanelViewImpl({
  runsDir,
  runId,
  engineState,
  width,
  height,
  active,
  eventLogReader,
}: EventsPanelViewProps): React.ReactElement {
  const [state, dispatch] = useReducer(eventsReducer, initialEventsPanelState);

  const activeRun = engineState.activeRun;
  const ring = useMemo<ReadonlyArray<EngineEvent>>(
    () =>
      activeRun && activeRun.runId === runId
        ? activeRun.events
        : Object.freeze([]),
    [activeRun, runId],
  );
  const info = engineState.runs.get(runId) ?? null;

  // Load persisted events once per terminal-run target.
  const loadedRef = useRef<string | null>(null);
  const [persisted, setPersisted] = React.useState<
    ReadonlyArray<EngineEvent>
  >(() => Object.freeze([]));

  useEffect(() => {
    const terminal =
      info !== null &&
      (info.status === "complete" || info.status === "error");
    if (!terminal) {
      loadedRef.current = null;
      if (persisted.length > 0) setPersisted(Object.freeze([]));
      return;
    }
    if (runsDir === null || eventLogReader === undefined) return;
    if (loadedRef.current === runId) return;
    loadedRef.current = runId;
    let cancelled = false;
    const runDir = `${runsDir}/${runId}`;
    eventLogReader(runDir).then(
      (events) => {
        if (cancelled) return;
        setPersisted(events);
      },
      () => {
        /* swallow — best-effort read */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runId, runsDir, info, eventLogReader, persisted.length]);

  // Reset reducer on target change.
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [runId]);

  // Feed merged events into the reducer.
  const merged = useMemo(
    () => mergeEventSources(ring, persisted),
    [ring, persisted],
  );
  useEffect(() => {
    dispatch({ type: "SET_EVENTS", events: merged });
  }, [merged]);

  // Keybindings — suppressed when the pane is not the active tab.
  useInput(
    (input, key) => {
      let act: EventsReducerAction | null = null;
      if (state.searchOpen) {
        if (key.return) {
          act = { type: "CLOSE_SEARCH", commit: true };
        } else if (key.escape) {
          act = { type: "CLOSE_SEARCH", commit: false };
        } else if (key.backspace) {
          act = {
            type: "SET_SEARCH_DRAFT",
            draft: state.searchDraft.slice(0, -1),
          };
        } else if (input && input.length > 0 && !key.ctrl && !key.meta) {
          act = {
            type: "SET_SEARCH_DRAFT",
            draft: state.searchDraft + input,
          };
        }
      } else {
        if (key.upArrow) act = { type: "SCROLL_DELTA", delta: -1 };
        else if (key.downArrow) act = { type: "SCROLL_DELTA", delta: 1 };
        else if (key.pageUp)
          act = { type: "SCROLL_PAGE", direction: "up", pageSize: 10 };
        else if (key.pageDown)
          act = { type: "SCROLL_PAGE", direction: "down", pageSize: 10 };
        else if (input === "f") act = { type: "TOGGLE_FOLLOW" };
        else if (input === "F") act = { type: "SCROLL_JUMP_HEAD" };
        else if (input === "G") act = { type: "SCROLL_JUMP_HEAD" };
        else if (input === "g") act = { type: "SCROLL_JUMP_TOP" };
        else if (input === "k")
          act = { type: "SET_FILTER_KINDS", kinds: cycleKinds(state.filter.kinds) };
        else if (input === "/") act = { type: "OPEN_SEARCH" };
      }
      if (act) dispatch(act);
    },
    { isActive: active === true },
  );

  const model = useMemo(
    () =>
      deriveEventsModel({
        state,
        viewport: { width, height },
        runId,
      }),
    [state, width, height, runId],
  );

  const status: EventsPaneStatus = {
    isFollowing: state.settings.follow,
    isMounted: true,
    searchOpen: state.searchOpen,
  };

  return (
    <EventsPaneStatusContext.Provider value={status}>
      <EventsPanel
        model={model}
        width={width}
        height={height}
        searchOpen={state.searchOpen}
        searchDraft={state.searchDraft}
      />
    </EventsPaneStatusContext.Provider>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const EventsPanelView = EventsPanelViewImpl;
