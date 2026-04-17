// src/components/keybar-fixtures/graph.ts
//
// Keybar fixture for the RUN-mode Graph tab (P6-T4). Mirrors mockups.md §1
// / §15 row `RUN (graph)`.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

export const GRAPH_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Up", "Down"],
    label: "Step",
    when: () => true,
    action: () => {
      /* owned by app.tsx / GraphPanelView — deferred in P6-T4. */
    },
  },
  {
    keys: ["Enter"],
    label: "Logs",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["a"],
    label: "Approve",
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["R"],
    label: "Re-run",
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["X"],
    label: "Cancel",
    destructive: true,
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["1"],
    label: "Graph",
    category: "VIEW",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["2"],
    label: "Detail",
    category: "VIEW",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["3"],
    label: "Log",
    category: "VIEW",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["4"],
    label: "Events",
    category: "VIEW",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["f"],
    label: "Follow",
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["/"],
    label: "Find",
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["?"],
    label: "Help",
    when: () => true,
    action: () => {
      /* deferred. */
    },
  },
  {
    keys: ["q"],
    label: "Quit",
    when: () => true,
    action: () => {
      /* owned by app.tsx global quit. */
    },
  },
];
