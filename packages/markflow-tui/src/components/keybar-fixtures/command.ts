// src/components/keybar-fixtures/command.ts
//
// Keybar fixture for the COMMAND palette overlay (P7-T3). Matches mockups
// §15 COMMAND row.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

/**
 * Full-tier row (mockups.md §10 line 397):
 *   [COMMAND]   ⏎ Run  ↑↓ Select  Tab Complete      Esc Cancel
 * Short/keys drop category spacing and omit labels.
 */
export const COMMAND_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Enter"],
    label: "Run",
    when: () => true,
    action: () => {
      /* owned by <CommandPaletteModal> useInput */
    },
  },
  {
    keys: ["Up", "Down"],
    label: "Select",
    when: () => true,
    action: () => {
      /* owned by <CommandPaletteModal> */
    },
    hideLabelOn: ["short", "keys"],
  },
  {
    keys: ["Tab"],
    label: "Complete",
    when: () => true,
    action: () => {
      /* owned by <CommandPaletteModal> */
    },
    hideLabelOn: ["short", "keys"],
    gapAfter: { full: 4 },
  },
  {
    keys: ["Esc"],
    label: "Cancel",
    when: () => true,
    action: () => {
      /* owned by <CommandPaletteModal> */
    },
    hideLabelOn: ["short", "keys"],
  },
];
