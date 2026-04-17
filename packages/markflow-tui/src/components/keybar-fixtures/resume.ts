// src/components/keybar-fixtures/resume.ts
//
// Keybar fixture for the RESUME wizard overlay (P7-T2). Mirrors mockups.md
// §7 line 299 and §15 RESUME row.
//
// PURITY NOTE: data-only. No react/ink/node:*.

import type { Binding } from "../types.js";

/**
 * Full-tier row (mockups.md §7 line 299):
 *   [RESUME]  ⏎ Resume  Space Toggle  Tab Next field  p Preview      Esc Cancel                        ? Help
 * Narrow tier drops `? Help` per §15.
 */
export const RESUME_KEYBAR: ReadonlyArray<Binding> = [
  {
    keys: ["Enter"],
    label: "Resume",
    when: () => true,
    action: () => {
      /* owned by <ResumeWizardModal> useInput */
    },
  },
  {
    keys: ["Space"],
    label: "Toggle",
    when: () => true,
    action: () => {
      /* owned by <ResumeWizardModal> */
    },
  },
  {
    keys: ["Tab"],
    label: "Next field",
    shortLabel: "Next",
    when: () => true,
    action: () => {
      /* owned by <ResumeWizardModal> */
    },
  },
  {
    keys: ["p"],
    label: "Preview",
    when: () => true,
    action: () => {
      /* non-MVP stub — see plan §7 D7 */
    },
  },
  {
    keys: ["Esc"],
    label: "Cancel",
    when: () => true,
    action: () => {
      /* owned by <ResumeWizardModal> */
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
