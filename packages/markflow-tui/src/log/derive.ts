// src/log/derive.ts
//
// Pure derivation from reducer state + target context → presentation-ready
// `LogPanelModel`. Handles the follow/paused window slice, wrap/truncate
// math, and header/footer copy.
//
// PURITY NOTE: no ink/react/node:* imports.

import { stripAnsi } from "./ansi.js";
import { linesSincePause } from "./reducer.js";
import type {
  LogLine,
  LogPanelEmptyReason,
  LogPanelModel,
  LogPanelRow,
  LogPanelState,
} from "./types.js";

export interface DeriveLogInput {
  readonly state: LogPanelState;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly target: { readonly nodeId: string; readonly stepSeq: number } | null;
  readonly empty: LogPanelEmptyReason | null;
}

const ELLIPSIS = "\u2026";
const GUTTER = 2; // leading "  " indent inside the panel

/** Convert a line's segments to plain text for rendering. */
function lineToText(line: LogLine): string {
  return line.segments.map((s) => s.text).join("") || stripAnsi("");
}

function truncateLine(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  if (budget === 1) return ELLIPSIS;
  return text.slice(0, budget - 1) + ELLIPSIS;
}

function wrapLine(text: string, budget: number): string[] {
  if (budget <= 0) return [];
  if (text.length === 0) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += budget) {
    out.push(text.slice(i, i + budget));
  }
  return out;
}

/** Format the header line — e.g. `Log · deploy-eu · seq=198 · following`. */
export function formatHeader(
  target: { readonly nodeId: string; readonly stepSeq: number },
  state: LogPanelState,
): string {
  const mode = state.follow ? "following" : "paused";
  const filter =
    state.settings.streamFilter === "both"
      ? ""
      : ` · ${state.settings.streamFilter}`;
  return `Log · ${target.nodeId} · seq=${target.stepSeq} · ${mode}${filter}`;
}

/**
 * Build the visible window, header, banner, and footer from the reducer
 * state + viewport. Returns an `empty` model when the target is unresolved.
 */
export function deriveLogModel(input: DeriveLogInput): LogPanelModel {
  const { state, viewport, target, empty } = input;

  if (empty || !target) {
    return {
      header: "",
      banner: null,
      rows: [],
      footer: null,
      empty: empty ?? { kind: "no-selection" },
      isFollowing: state.follow,
    };
  }

  const filtered = state.lines.filter((l) => {
    const f = state.settings.streamFilter;
    if (f === "both") return true;
    return l.stream === f;
  });

  // Reserve 1 row for the header, optional 1 row for the paused banner, and
  // optional 1 row for the footer.
  const bannerRows = !state.follow ? 1 : 0;
  const footerRows = 1; // reserved (live-tail or more-below or blank)
  const logRows = Math.max(0, viewport.height - 1 - bannerRows - footerRows);

  const budget = Math.max(1, viewport.width - GUTTER);

  // Pick the window.
  let visibleLines: LogLine[];
  let hidden = 0;
  if (state.follow) {
    const start = Math.max(0, filtered.length - logRows);
    visibleLines = filtered.slice(start);
  } else {
    // Paused — centre on cursor if possible.
    const lineAtCursor = state.lines[state.cursor];
    let cursorInFiltered = -1;
    if (lineAtCursor) {
      cursorInFiltered = filtered.indexOf(lineAtCursor);
    }
    if (cursorInFiltered < 0) {
      cursorInFiltered = Math.min(filtered.length - 1, Math.max(0, state.cursor));
    }
    const half = Math.floor(logRows / 2);
    const start = Math.max(0, Math.min(filtered.length - logRows, cursorInFiltered - half));
    visibleLines = filtered.slice(start, start + logRows);
    hidden = Math.max(0, filtered.length - (start + visibleLines.length));
  }

  const rows: LogPanelRow[] = [];
  for (const line of visibleLines) {
    const text = lineToText(line);
    if (state.settings.wrap) {
      for (const piece of wrapLine(text, budget)) {
        rows.push({ line, text: piece });
        if (rows.length >= logRows) break;
      }
    } else {
      rows.push({ line, text: truncateLine(text, budget) });
    }
    if (rows.length >= logRows) break;
  }

  const footer: LogPanelModel["footer"] = state.follow
    ? { kind: "live-tail" }
    : hidden > 0
      ? { kind: "more-below", hidden }
      : null;

  const banner: LogPanelModel["banner"] = state.follow
    ? null
    : { kind: "paused", linesSincePause: linesSincePause(state) };

  return {
    header: formatHeader(target, state),
    banner,
    rows,
    footer,
    empty: null,
    isFollowing: state.follow,
  };
}

export function emptyReasonLabel(reason: LogPanelEmptyReason): string {
  switch (reason.kind) {
    case "no-selection":
      return "select a step to see its log";
    case "pending":
      return "log not yet available — waiting for step to start";
    case "not-found":
      return `step ${reason.id} not found`;
    case "aggregate":
      return "pick a leaf step to see its log";
  }
}
