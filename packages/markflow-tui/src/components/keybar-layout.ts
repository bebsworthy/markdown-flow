// src/components/keybar-layout.ts
//
// Pure layout helpers for the keybar primitive. No React, no Ink, no
// node:*. Registered in test/state/purity.test.ts.
//
// Authoritative spec refs:
//   - docs/tui/features.md §5.6 (rules)
//   - docs/tui/mockups.md §15   (acceptance matrix)
//   - docs/tui/plans/P3-T4.md   (this-task plan)

import type { Binding, AppContext } from "./types.js";

export type Tier = "full" | "short" | "keys";

// ---------------------------------------------------------------------------
// formatKeys
// ---------------------------------------------------------------------------

const NAMED_KEY_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  Enter: "\u23CE", // ⏎
  // "Esc", "Space", "Tab" render as their literal name
});

const ARROW_NAMES = new Set(["Up", "Down", "Left", "Right"]);

/**
 * Formats a KeySpec per plan §3 step 7.
 *
 * - Arrow family (subset of {Up, Down, Left, Right}) is grouped into a
 *   compact unbracketed glyph sequence ("↑↓", "←→", "↑↓←→"). Ordering in
 *   the input is tolerated; output order is fixed (up, down, left, right).
 * - Modifier + key (["Ctrl", "r"]) renders as "Ctrl + <r>".
 * - Named keys: Enter → ⏎; Esc/Space/Tab render literally.
 * - Single printable key renders unbracketed.
 * - Unknown tokens pass through literally.
 */
export function formatKeys(keys: ReadonlyArray<string>): string {
  if (keys.length === 0) return "";

  // Arrow family grouping
  if (keys.length >= 2 && keys.every((k) => ARROW_NAMES.has(k))) {
    const set = new Set(keys);
    let out = "";
    if (set.has("Up")) out += "\u2191"; // ↑
    if (set.has("Down")) out += "\u2193"; // ↓
    if (set.has("Left")) out += "\u2190"; // ←
    if (set.has("Right")) out += "\u2192"; // →
    return out;
  }

  // Modifier + key: last element is the key, preceding are modifiers.
  if (keys.length >= 2) {
    const mods = keys.slice(0, -1);
    const key = keys[keys.length - 1]!;
    return `${mods.join(" + ")} + <${key}>`;
  }

  // Single token
  const only = keys[0]!;
  if (only in NAMED_KEY_GLYPHS) return NAMED_KEY_GLYPHS[only]!;
  return only;
}

// ---------------------------------------------------------------------------
// pickTier
// ---------------------------------------------------------------------------

/**
 * Returns the tier given a terminal width and category count.
 *
 * Width bands per features.md §5.6 rule 7, read as closed-at-60 /
 * open-at-100: [100,∞) → "full"; [60,99] → "short"; [0,59] → "keys".
 *
 * Category overflow (plan §0 ambiguity 3): if >2 categories survive
 * filtering, force tier down one step (full → short). The keys tier is
 * unaffected.
 */
export function pickTier(width: number, categoryCount: number): Tier {
  if (width < 60) return "keys";
  if (width >= 100 && categoryCount <= 2) return "full";
  return "short";
}

// ---------------------------------------------------------------------------
// filterBindings
// ---------------------------------------------------------------------------

/**
 * Applies `toggleLabel(ctx.toggleState)` to the `label` of each binding
 * that defines one, then filters out bindings whose `when(ctx)` returns
 * false (rule 5: hide, don't grey).
 */
export function filterBindings(
  bindings: ReadonlyArray<Binding>,
  ctx: AppContext,
): ReadonlyArray<Binding> {
  const out: Binding[] = [];
  for (const b of bindings) {
    if (!b.when(ctx)) continue;
    if (b.toggleLabel) {
      out.push({ ...b, label: b.toggleLabel(ctx.toggleState) });
    } else {
      out.push(b);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// sortByOrder
// ---------------------------------------------------------------------------

const GLOBAL_KEYS = new Set(["?", "q", "Esc"]);

function orderClass(b: Binding): 0 | 1 | 2 {
  // Globals detected by key (rule 3).
  if (b.keys.length === 1 && GLOBAL_KEYS.has(b.keys[0]!)) return 2;
  // VIEW-category toggles.
  if (b.category === "VIEW") return 1;
  return 0;
}

/**
 * Stable sort by rule 3 ordering class: locals → toggles → globals.
 */
export function sortByOrder(
  bindings: ReadonlyArray<Binding>,
): ReadonlyArray<Binding> {
  return [...bindings]
    .map((b, i) => ({ b, i, k: orderClass(b) }))
    .sort((a, z) => (a.k - z.k) || (a.i - z.i))
    .map((x) => x.b);
}

// ---------------------------------------------------------------------------
// groupByCategory
// ---------------------------------------------------------------------------

/**
 * Groups already-filtered-and-sorted bindings by category, preserving
 * order. Returns [category|null, Binding[]] pairs; `null` means "no
 * category — render with no header".
 */
export function groupByCategory(
  bindings: ReadonlyArray<Binding>,
): ReadonlyArray<readonly [string | null, ReadonlyArray<Binding>]> {
  const groups: Array<[string | null, Binding[]]> = [];
  for (const b of bindings) {
    const cat = b.category ?? null;
    const last = groups[groups.length - 1];
    if (last && last[0] === cat) {
      last[1].push(b);
    } else {
      groups.push([cat, [b]]);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// renderableLabel
// ---------------------------------------------------------------------------

/**
 * Resolves the rendered text for a binding at a given tier (plan §3 step 6).
 *
 * - full tier: "<keys> <label>"
 * - short tier: "<keys> <shortLabel>" if shortLabel is defined, else just "<keys>"
 * - keys tier: just "<keys>"
 */
export function renderableLabel(b: Binding, tier: Tier): string {
  const keys = formatKeys(b.keys);
  if (tier === "keys") return keys;
  if (tier === "short") {
    if (b.shortLabel !== undefined && b.shortLabel.length > 0) {
      return `${keys} ${b.shortLabel}`;
    }
    return keys;
  }
  // full tier
  return `${keys} ${b.label}`;
}

// ---------------------------------------------------------------------------
// countCategories
// ---------------------------------------------------------------------------

/** Counts distinct (non-null) categories across a filtered binding list. */
export function countCategories(bindings: ReadonlyArray<Binding>): number {
  const set = new Set<string>();
  for (const b of bindings) if (b.category) set.add(b.category);
  return set.size;
}

// ---------------------------------------------------------------------------
// gapAfter resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a binding's `gapAfter` to a non-negative integer for the given
 * tier. Returns 0 when the binding has no override or has not specified a
 * value for this tier.
 */
export function resolveGapAfter(b: Binding, tier: Tier): number {
  const g = b.gapAfter;
  if (g === undefined) return 0;
  if (typeof g === "number") return g;
  const v = g[tier];
  return typeof v === "number" ? v : 0;
}

