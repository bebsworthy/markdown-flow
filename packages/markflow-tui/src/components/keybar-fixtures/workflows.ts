// src/components/keybar-fixtures/workflows.ts
//
// Keybar fixture for the non-empty workflow browser (P3-T4). Mirrors
// mockups.md §2 line 71 / §15 row WORKFLOWS:
//   ↑↓ Select  ⏎ Open  r Run  e Edit in $EDITOR     ? Help   q Quit
//
// PURITY NOTE: data-only. No react/ink/node:*. Listed in purity.test.ts.

import type { Binding } from "../types.js";

export const WORKFLOWS_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Up", "Down"],
    label: "Select",
    when: () => true,
    action: () => {
      /* owned by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["Enter"],
    label: "Open",
    when: () => true,
    action: () => {
      /* owned by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["r"],
    label: "Run",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["a"],
    label: "Add",
    when: () => true,
    action: () => {
      /* owned by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["d"],
    label: "Remove",
    when: () => true,
    action: () => {
      /* owned by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["e"],
    label: "Edit in $EDITOR",
    shortLabel: "Edit",
    when: () => true,
    action: () => {
      /* owned by app.tsx. */
    },
  },
  {
    keys: ["?"],
    label: "Help",
    gapAfter: 3,
    when: () => true,
    action: () => {
      /* owned by app.tsx help overlay. */
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
