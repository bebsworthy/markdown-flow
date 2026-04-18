// src/components/keybar-fixtures/runs.ts
//
// Keybar fixture for RUNS mode (browsing.runs). Mirrors mockups.md §1
// line 36 / §15 row RUNS:
//   ↑↓ Select  ⏎ Open  r Resume  a Approve   s Status  / Search     ? q
//
// PURITY NOTE: data-only. No react/ink/node:*. Listed in purity.test.ts.

import type { Binding } from "../types.js";

export const RUNS_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Up", "Down"],
    label: "Select",
    when: () => true,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
  },
  {
    keys: ["Enter"],
    label: "Open",
    when: () => true,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
  },
  {
    keys: ["r"],
    label: "Resume",
    toggleLabel: (state) => {
      const n =
        typeof state === "number"
          ? state
          : typeof state === "object" &&
              state !== null &&
              "suspendedRunsCount" in state
            ? (state as { suspendedRunsCount: number }).suspendedRunsCount
            : 0;
      return `Resume (${n})`;
    },
    when: (ctx) => (ctx.suspendedRunsCount ?? 0) > 0,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
  },
  {
    keys: ["a"],
    label: "Approve",
    when: () => true,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
    hideOnTier: ["keys"],
  },
  {
    keys: ["s"],
    label: "Status",
    when: () => true,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* owned by runs-table.tsx useInput. */
    },
    hideOnTier: ["keys"],
  },
  {
    keys: ["?"],
    label: "Help",
    when: () => true,
    action: () => {
      /* owned by app.tsx help overlay. */
    },
    hideLabelOn: ["full", "short", "keys"],
  },
  {
    keys: ["q"],
    label: "Quit",
    when: () => true,
    action: () => {
      /* owned by app.tsx global quit. */
    },
    hideLabelOn: ["full", "short", "keys"],
  },
];
