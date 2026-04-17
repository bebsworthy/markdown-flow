// src/components/keybar-fixtures/help.ts
//
// Keybar fixture for the HELP overlay (P7-T3). Matches mockups §15 HELP row.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

/**
 * Full-tier row (mockups.md §11 line 434):
 *   [HELP]   ↑↓ Navigate   / Search   Esc Close
 * Short/keys drop labels.
 */
export const HELP_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Up", "Down"],
    label: "Navigate",
    when: () => true,
    action: () => {
      /* owned by <HelpOverlay> */
    },
    hideLabelOn: ["short", "keys"],
  },
  {
    keys: ["/"],
    label: "Search",
    when: () => true,
    action: () => {
      /* owned by <HelpOverlay> */
    },
    hideLabelOn: ["short", "keys"],
  },
  {
    keys: ["Esc"],
    label: "Close",
    when: () => true,
    action: () => {
      /* owned by <HelpOverlay> */
    },
    hideLabelOn: ["short", "keys"],
  },
];
