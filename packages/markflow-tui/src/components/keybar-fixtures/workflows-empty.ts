// src/components/keybar-fixtures/workflows-empty.ts
//
// Restricted keybar fixture for the empty-state workflow browser (P4-T3).
// Rendered beneath the shell when `registryState.entries.length === 0` and
// the user is in browsing.workflows mode.
//
// Authoritative references:
//   - docs/tui/mockups.md §2 line 92: "WORKFLOWS  a Add     ? Help   q Quit".
//   - docs/tui/plans/P4-T3.md §4.2.
//
// PURITY NOTE: this file declares a data-only fixture. It MUST NOT import
// from `react`, `ink`, `node:*`, or any I/O / rendering surface. Listed in
// test/state/purity.test.ts::files[].

import type { Binding } from "../types.js";

/**
 * Empty-state keybar: Add / Help / Quit. Action handlers are no-ops — the
 * app-level key router wires the real behaviour (`a` opens the add modal
 * via the browser's own useInput handler; `?` is reserved for the help
 * overlay landing in a later task; `q` is the global quit binding).
 *
 * Keeping the fixture declarative means the Keybar primitive can render it
 * unchanged across tiers, and a future fixture-snapshot test can lock in
 * the exact mockup row from §2 line 92.
 */
export const WORKFLOWS_EMPTY_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["a"],
    label: "Add",
    when: () => true,
    action: () => {
      /* no-op — wired by workflow-browser.tsx useInput. */
    },
  },
  {
    keys: ["?"],
    label: "Help",
    when: () => true,
    action: () => {
      /* no-op — help overlay deferred. */
    },
  },
  {
    keys: ["q"],
    label: "Quit",
    when: () => true,
    action: () => {
      /* no-op — quit is the global binding in app.tsx. */
    },
  },
];
