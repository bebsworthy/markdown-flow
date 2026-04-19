// src/components/keybar-fixtures/workflows.ts
//
// Keybar fixture for the non-empty workflow browser.
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
    keys: ["r"],
    label: "Run",
    when: (ctx) => ctx.selectedEntryValid !== false,
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
    keys: ["c"],
    label: "Copy Path",
    shortLabel: "Copy",
    when: (ctx) => ctx.selectedEntryValid !== false,
    action: () => {
      /* owned by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["z"],
    label: "Fold",
    when: () => true,
    action: () => {
      /* owned by app.tsx global useInput. */
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
