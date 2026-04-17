// src/components/keybar-fixtures/events.ts
//
// Keybar fixtures for the RUN-mode Events tab (P6-T4). Two variants cover
// follow and paused states, matching the LOG precedent from P6-T3.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

export const EVENTS_FOLLOWING_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["f"],
    label: "Follow",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["k"],
    label: "Kind",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["n"],
    label: "Node",
    when: () => true,
    action: () => {
      /* deferred — currently no-op. */
    },
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["Esc"],
    label: "Back to graph",
    when: () => true,
    action: () => {
      /* owned by app.tsx global Esc handler. */
    },
  },
];

export const EVENTS_PAUSED_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["F"],
    label: "Resume follow",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["G"],
    label: "Jump to head",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["g"],
    label: "Jump to top",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["k"],
    label: "Kind",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* owned by <EventsPanelView>. */
    },
  },
  {
    keys: ["Esc"],
    label: "Back",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
];
