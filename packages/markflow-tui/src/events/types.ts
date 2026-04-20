// src/events/types.ts
//
// Type-only surface for the Events tab (P6-T4). Zero runtime exports.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §2
//
// PURITY NOTE: no ink/react/node:* imports.

import type { EngineEvent } from "markflow-cli";
import type { ColorRole } from "../theme/tokens.js";

export type EventKindGroup =
  | "run"
  | "token"
  | "step"
  | "route"
  | "retry"
  | "batch";

export interface EventsFilter {
  readonly kinds: "all" | ReadonlySet<EventKindGroup>;
  readonly nodeId: string | null;
  readonly search: string;
}

export interface EventsPanelSettings {
  readonly follow: boolean;
}

export interface EventsPanelState {
  readonly events: readonly EngineEvent[];
  readonly filter: EventsFilter;
  readonly settings: EventsPanelSettings;
  /** Index into the filtered view. */
  readonly cursor: number;
  readonly pausedAtHeadFilteredIdx: number | null;
  readonly searchOpen: boolean;
  readonly searchDraft: string;
}

export interface EventsPanelRow {
  readonly seq: number;
  readonly ts: string;
  readonly kindLabel: string;
  readonly group: EventKindGroup;
  readonly nodeId: string | null;
  readonly summary: string;
  readonly role: ColorRole;
}

export type EventsPanelEmptyReason =
  | { readonly kind: "no-run" }
  | { readonly kind: "no-events" }
  | { readonly kind: "filtered-out" };

export interface EventsPanelModel {
  readonly header: string;
  readonly banner:
    | { readonly kind: "paused"; readonly newSincePause: number }
    | null;
  readonly rows: readonly EventsPanelRow[];
  readonly footer:
    | { readonly kind: "more-below"; readonly hidden: number }
    | { readonly kind: "live-tail" }
    | null;
  readonly empty: EventsPanelEmptyReason | null;
  readonly isFollowing: boolean;
}

export type EventsReducerAction =
  | { readonly type: "SET_EVENTS"; readonly events: readonly EngineEvent[] }
  | {
      readonly type: "SET_FILTER_KINDS";
      readonly kinds: "all" | ReadonlySet<EventKindGroup>;
    }
  | { readonly type: "SET_NODE_FILTER"; readonly nodeId: string | null }
  | { readonly type: "SET_SEARCH"; readonly search: string }
  | { readonly type: "OPEN_SEARCH" }
  | { readonly type: "CLOSE_SEARCH"; readonly commit: boolean }
  | { readonly type: "SET_SEARCH_DRAFT"; readonly draft: string }
  | { readonly type: "TOGGLE_FOLLOW" }
  | { readonly type: "SCROLL_DELTA"; readonly delta: number }
  | { readonly type: "SCROLL_JUMP_HEAD" }
  | { readonly type: "SCROLL_JUMP_TOP" }
  | {
      readonly type: "SCROLL_PAGE";
      readonly direction: "up" | "down";
      readonly pageSize: number;
    }
  | { readonly type: "RESET" };
