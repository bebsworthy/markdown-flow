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
    toggleLabel: (state) => {
      // Narrow: fixtures consuming `toggleState.pendingApprovalsCount`
      // pass a plain number; be defensive for other shapes.
      const n = typeof state === "number" ? state : 0;
      return `Approve (${n})`;
    },
    // Hide-don't-grey (features.md §5.6 rule 5): the binding is suppressed
    // entirely when no approvals are pending. Count is surfaced through
    // `ctx.pendingApprovalsCount` (P7-T1).
    when: (ctx) => (ctx.pendingApprovalsCount ?? 0) > 0,
    action: () => {
      /* owned by app.tsx global `a` handler (P7-T1). */
    },
  },
  {
    keys: ["R"],
    label: "Re-run",
    // Hide-don't-grey (features.md §5.6 rule 5): the binding is suppressed
    // entirely unless the active run is resumable (status in
    // {"error","suspended"}). Surfaced through `ctx.runResumable` (P7-T2).
    when: (ctx) => ctx.runResumable === true,
    action: () => {
      /* owned by app.tsx global `R` handler (P7-T2). */
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
    label: "Back",
    when: () => true,
    action: () => {
      /* owned by app.tsx: MODE_CLOSE_RUN in viewing mode. */
    },
  },
];
