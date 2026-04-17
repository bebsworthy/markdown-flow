// src/components/viewing-pane-tabs-layout.ts
//
// Pure layout helpers for the viewing-pane bottom-frame tab header. Returns
// plain text tokens + an active flag; the Ink component decides inverse-video
// styling.
//
// Authoritative references:
//   - docs/tui/mockups.md §12 (medium-tier letter-bracket form)
//   - docs/tui/plans/P8-T1.md §2, §3
//
// PURITY NOTE: no ink/react/node:* imports. Registered in
// test/state/purity.test.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable keys for the four viewing-pane tabs (matches ViewingFocus sum). */
export type ViewingTabKey = "graph" | "detail" | "log" | "events";

/** Three width tiers for the tab header, independent of keybar tier. */
export type ViewingTabTier = "wide" | "medium" | "narrow";

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

/**
 * Tier thresholds (plan §2.1 + §3.2 + D4):
 *   width >= 120 -> "wide"     (full words:       "[ Graph ]  Detail  Log  Events")
 *   width >=  70 -> "medium"   (letter-bracket:   "[G]raph  [D]etail  [L]og  [E]vents")
 *   else         -> "narrow"   (single letters:   "G  D  L  E" with active inverted)
 */
export const VIEWING_TAB_WIDE_MIN = 120;
export const VIEWING_TAB_MEDIUM_MIN = 70;

export function pickViewingTabTier(width: number): ViewingTabTier {
  if (width >= VIEWING_TAB_WIDE_MIN) return "wide";
  if (width >= VIEWING_TAB_MEDIUM_MIN) return "medium";
  return "narrow";
}

// ---------------------------------------------------------------------------
// Tab keys in display order
// ---------------------------------------------------------------------------

export const VIEWING_TAB_KEYS: ReadonlyArray<ViewingTabKey> = Object.freeze([
  "graph",
  "detail",
  "log",
  "events",
]);

const WORD_FOR: Readonly<Record<ViewingTabKey, string>> = Object.freeze({
  graph: "Graph",
  detail: "Detail",
  log: "Log",
  events: "Events",
});

const LETTER_FOR: Readonly<Record<ViewingTabKey, string>> = Object.freeze({
  graph: "G",
  detail: "D",
  log: "L",
  events: "E",
});

// ---------------------------------------------------------------------------
// formatViewingTabLabel — structural text per tier/key
// ---------------------------------------------------------------------------

/**
 * Formats a single tab label for a given tier. The component (not this
 * helper) decides inverse vs. plain styling. This function returns
 * structural text only.
 *
 *   wide   -> "Graph" / "Detail" / "Log" / "Events"
 *   medium -> "[G]raph" / "[D]etail" / "[L]og" / "[E]vents"
 *   narrow -> "G" / "D" / "L" / "E"
 */
export function formatViewingTabLabel(
  key: ViewingTabKey,
  tier: ViewingTabTier,
): string {
  if (tier === "wide") return WORD_FOR[key];
  if (tier === "narrow") return LETTER_FOR[key];
  // medium — letter-bracket: e.g. "[G]raph"
  const word = WORD_FOR[key];
  const letter = word[0]!;
  const rest = word.slice(1);
  return `[${letter}]${rest}`;
}

// ---------------------------------------------------------------------------
// composeViewingTabRow
// ---------------------------------------------------------------------------

export interface ViewingTabToken {
  readonly text: string;
  readonly active: boolean;
}

export interface ViewingTabRow {
  readonly tokens: ReadonlyArray<ViewingTabToken>;
  readonly suffix: string | null;
  readonly tier: ViewingTabTier;
}

/**
 * Composes the full tab-header row: four token records (one per tab) and
 * an optional right-aligned suffix. The component wraps the active token
 * in `<Text inverse bold>` — structural styling is not this helper's job.
 *
 * Narrow tier drops the suffix to preserve the bare-letter row.
 */
export function composeViewingTabRow(
  active: ViewingTabKey,
  width: number,
  suffix?: string,
): ViewingTabRow {
  const tier = pickViewingTabTier(width);
  const tokens: ViewingTabToken[] = VIEWING_TAB_KEYS.map((key) => ({
    text: formatViewingTabLabel(key, tier),
    active: key === active,
  }));
  const resolvedSuffix =
    tier === "narrow" ? null : typeof suffix === "string" && suffix.length > 0
      ? suffix
      : null;
  return {
    tokens,
    suffix: resolvedSuffix,
    tier,
  };
}
