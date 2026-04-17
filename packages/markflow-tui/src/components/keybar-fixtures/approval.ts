// src/components/keybar-fixtures/approval.ts
//
// Keybar fixture for the APPROVAL modal (P7-T1). Mirrors mockups.md §5 and
// §15 APPROVAL row.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

/**
 * Full-tier row (mockups.md §5 line 214):
 *   [APPROVAL]  ⏎ Decide  s Suspend-for-later   Esc Cancel   ? Help
 * Narrow tier drops `? Help` per §15.
 */
export const APPROVAL_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Enter"],
    label: "Decide",
    when: () => true,
    action: () => {
      /* owned by <ApprovalModal> useInput */
    },
  },
  {
    keys: ["s"],
    label: "Suspend-for-later",
    shortLabel: "Suspend",
    when: () => true,
    action: () => {
      /* owned by <ApprovalModal> */
    },
  },
  {
    keys: ["Esc"],
    label: "Cancel",
    when: () => true,
    action: () => {
      /* owned by <ApprovalModal> */
    },
  },
  {
    keys: ["?"],
    label: "Help",
    hideOnTier: ["keys"],
    when: () => true,
    action: () => {
      /* help overlay deferred */
    },
  },
];
