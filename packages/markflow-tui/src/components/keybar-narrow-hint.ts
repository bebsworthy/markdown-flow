// src/components/keybar-narrow-hint.ts
//
// Pure helper deciding whether to render the keys-tier right-side hint
// ("? for labels") at narrow width.
//
// Authoritative references:
//   - docs/tui/mockups.md §13 line 505 (hint on right side of keys row)
//   - docs/tui/features.md §5.6 rule 7 ("<60 cols: keys only + hint")
//   - docs/tui/plans/P8-T2.md §2.2
//
// PURITY NOTE: no react/ink/node:* imports. Registered in
// test/state/purity.test.ts.

import type { Tier } from "./keybar-layout.js";

/** Canonical right-side hint at keys tier — mockups.md §13 line 505. */
export const KEYS_TIER_HINT = "? for labels";

/** Minimum cols of whitespace slack between bindings row and the hint. */
const HINT_SLACK_COLS = 4;

/**
 * Decides whether to render the `? for labels` right-side hint.
 * Returns the hint string (KEYS_TIER_HINT) or null.
 *
 * Rule: render only when `tier === "keys"` AND
 * `width - rowLen - HINT_SLACK_COLS >= KEYS_TIER_HINT.length`.
 *
 * The 4-col slack is a safety margin for trailing whitespace + separator.
 * At the low end of `width`, the hint is dropped (not truncated) so the
 * affordance is never misrepresented — see plan §6 D18.
 */
export function composeKeybarTrailingHint(
  tier: Tier,
  width: number,
  rowLen: number,
): string | null {
  if (tier !== "keys") return null;
  const slack = width - rowLen - HINT_SLACK_COLS;
  if (slack < KEYS_TIER_HINT.length) return null;
  return KEYS_TIER_HINT;
}
