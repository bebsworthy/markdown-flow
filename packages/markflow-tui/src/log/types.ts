// src/log/types.ts
//
// Type-only surface for the streaming log panel (P6-T3). Zero runtime
// exports — mirrors `src/steps/detail-types.ts` discipline.
//
// Authoritative references:
//   - docs/tui/features.md §3.5
//   - docs/tui/mockups.md §8 (following), §9 (paused)
//   - docs/tui/plans/P6-T3.md §2
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// or any I/O / rendering surface. Type-only imports only.

export type LogStream = "stdout" | "stderr";

/** Structured ANSI color output from `parseAnsi`. */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite"
  | { readonly kind: "256"; readonly index: number }
  | { readonly kind: "rgb"; readonly r: number; readonly g: number; readonly b: number };

export interface LogLineSegment {
  readonly text: string;
  readonly color?: AnsiColor;
  readonly bgColor?: AnsiColor;
  readonly bold?: true;
  readonly dim?: true;
  readonly italic?: true;
  readonly underline?: true;
}

export interface LogLine {
  /** stepSeq of the owning `step:start` event. */
  readonly seq: number;
  /** Monotonic per-stream line counter within this step. */
  readonly lineIndex: number;
  readonly stream: LogStream;
  /** ISO timestamp when known; null for sidecar-file lines. */
  readonly ts: string | null;
  readonly segments: readonly LogLineSegment[];
  readonly rawLength: number;
}

export interface LogPanelSettings {
  readonly streamFilter: "stdout" | "stderr" | "both";
  readonly wrap: boolean;
  /** `t` toggle — reserved for a later task; current renderer ignores. */
  readonly timestamps: boolean;
}

export interface LogPanelState {
  readonly lines: readonly LogLine[];
  /** Lines evicted from the front of the ring (keeps seq semantics faithful). */
  readonly dropped: number;
  readonly follow: boolean;
  readonly cursor: number;
  readonly pausedAtHeadSeq: number | null;
  readonly settings: LogPanelSettings;
  readonly partialByStream: Readonly<Record<LogStream, string>>;
}

export interface LogPanelRow {
  readonly line: LogLine;
  /** Rendered text after wrap/truncate — may contain an ellipsis. */
  readonly text: string;
}

export type LogPanelEmptyReason =
  | { readonly kind: "no-selection" }
  | { readonly kind: "pending" }
  | { readonly kind: "not-found"; readonly id: string }
  | { readonly kind: "aggregate" };

export interface LogPanelModel {
  readonly header: string;
  readonly banner:
    | { readonly kind: "paused"; readonly linesSincePause: number }
    | null;
  readonly rows: readonly LogPanelRow[];
  readonly footer:
    | { readonly kind: "more-below"; readonly hidden: number }
    | { readonly kind: "live-tail" }
    | null;
  readonly empty: LogPanelEmptyReason | null;
  readonly isFollowing: boolean;
}

export type LogReducerAction =
  | { readonly type: "APPEND_LINES"; readonly lines: readonly LogLine[] }
  | { readonly type: "SET_PARTIAL"; readonly stream: LogStream; readonly buf: string }
  | { readonly type: "SET_FOLLOW"; readonly follow: boolean }
  | { readonly type: "SET_WRAP"; readonly wrap: boolean }
  | { readonly type: "SET_TIMESTAMPS"; readonly timestamps: boolean }
  | { readonly type: "SET_STREAM_FILTER"; readonly filter: LogPanelSettings["streamFilter"] }
  | { readonly type: "SCROLL_DELTA"; readonly delta: number }
  | { readonly type: "SCROLL_PAGE"; readonly direction: "up" | "down"; readonly pageSize: number }
  | { readonly type: "SCROLL_JUMP_HEAD" }
  | { readonly type: "SCROLL_JUMP_TOP" }
  | { readonly type: "RESET" };

/** Ring-buffer cap. Matches features.md §3.5 ("~2k lines"). */
export const LOG_RING_CAP = 2000;
