// src/events/derive.ts
//
// Pure derivation from reducer state → presentation-ready model.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §3.2
//
// PURITY NOTE: no ink/react/node:* imports.

import { buildSearchHaystack, formatEventRow } from "./format.js";
import { matchesFilter } from "./filter.js";
import { eventsSincePause } from "./reducer.js";
import type {
  EventsPanelEmptyReason,
  EventsPanelModel,
  EventsPanelRow,
  EventsPanelState,
} from "./types.js";

export interface DeriveEventsInput {
  readonly state: EventsPanelState;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly runId: string | null;
}

const HEADER_ROWS = 1;

function shortRunId(id: string | null): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function deriveEventsModel(input: DeriveEventsInput): EventsPanelModel {
  const { state, viewport, runId } = input;

  if (viewport.height <= 0) {
    return {
      header: "",
      banner: null,
      rows: [],
      footer: null,
      empty: { kind: "no-run" },
      isFollowing: state.settings.follow,
    };
  }

  if (runId === null) {
    return {
      header: "",
      banner: null,
      rows: [],
      footer: null,
      empty: { kind: "no-run" },
      isFollowing: state.settings.follow,
    };
  }

  const total = state.events.length;
  const filteredRows: EventsPanelRow[] = [];
  for (const e of state.events) {
    const hay = buildSearchHaystack(e);
    if (matchesFilter(e, state.filter, hay)) {
      filteredRows.push(formatEventRow(e));
    }
  }

  const filtered = filteredRows.length;
  const header = `Events · ${shortRunId(runId)} · ${filtered} / ${total}`;

  let empty: EventsPanelEmptyReason | null = null;
  if (total === 0) empty = { kind: "no-events" };
  else if (filtered === 0) empty = { kind: "filtered-out" };

  if (empty) {
    return {
      header,
      banner: null,
      rows: [],
      footer: null,
      empty,
      isFollowing: state.settings.follow,
    };
  }

  const bannerRows = !state.settings.follow ? 1 : 0;
  const footerRows = 1;
  const logRows = Math.max(
    0,
    viewport.height - HEADER_ROWS - bannerRows - footerRows,
  );

  // Pick the window.
  let start = 0;
  let end = 0;
  if (state.settings.follow) {
    start = Math.max(0, filtered - logRows);
    end = filtered;
  } else {
    // Center on cursor (cursor is an index into state.events, not filtered;
    // best-effort: clamp relative to filtered length).
    const cursor = Math.min(state.cursor, filtered - 1);
    const half = Math.floor(logRows / 2);
    start = Math.max(0, Math.min(filtered - logRows, cursor - half));
    end = Math.min(filtered, start + logRows);
  }
  const visible = filteredRows.slice(start, end);
  const hidden = Math.max(0, filtered - end);

  const footer: EventsPanelModel["footer"] = state.settings.follow
    ? { kind: "live-tail" }
    : hidden > 0
      ? { kind: "more-below", hidden }
      : null;

  const banner: EventsPanelModel["banner"] = state.settings.follow
    ? null
    : { kind: "paused", newSincePause: eventsSincePause(state) };

  return {
    header,
    banner,
    rows: visible,
    footer,
    empty: null,
    isFollowing: state.settings.follow,
  };
}

export function emptyReasonLabel(reason: EventsPanelEmptyReason): string {
  switch (reason.kind) {
    case "no-run":
      return "no run selected";
    case "no-events":
      return "no events yet — waiting for run to start";
    case "filtered-out":
      return "no events match current filter";
  }
}
