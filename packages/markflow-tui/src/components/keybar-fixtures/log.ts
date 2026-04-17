// src/components/keybar-fixtures/log.ts
//
// Keybar fixtures for the streaming log pane (P6-T3). Two variants cover
// the follow and paused states per mockups.md §8 / §9 / §15.
//
// PURITY NOTE: data-only. Must not import from react / ink / node:*.

import type { Binding } from "../types.js";

/** Fixture when the log pane is following the live tail. */
export const LOG_FOLLOWING_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["w"],
    label: "Wrap",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView> useInput */
    },
  },
  {
    keys: ["t"],
    label: "Timestamps",
    when: () => true,
    action: () => {
      /* no-op — deferred (plan §9 D10). */
    },
  },
  {
    keys: ["1"],
    label: "stdout",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["2"],
    label: "stderr",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["3"],
    label: "both",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* reserved for a later task. */
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

/** Fixture when the log pane is paused (scroll above last line). */
export const LOG_PAUSED_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["F"],
    label: "Resume follow",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["G"],
    label: "Jump to head",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["g"],
    label: "Jump to top",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["w"],
    label: "Wrap",
    when: () => true,
    action: () => {
      /* owned by <LogPanelView>. */
    },
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* reserved. */
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
