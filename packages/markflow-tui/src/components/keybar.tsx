// src/components/keybar.tsx
//
// The Keybar primitive — a single-line responsive status/command bar.
// Implements P3-T4 per docs/tui/features.md §5.6 and docs/tui/mockups.md §15.
//
// Wiring note: this file is the ONLY component file in this task allowed
// to import `react` / `ink`. Layout logic lives in keybar-layout.ts (pure)
// so it is unit-testable and purity-scannable.
//
// Colour policy (rule 10):
//   - Key tokens (formatKeys output) render in theme.colors.accent + bold.
//   - Labels render in default text colour.
//   - Category headers render bold + dim (theme.colors.dim).
//   - Destructive bindings render entirely in theme.colors.danger
//     (suppressing the accent-on-key split). See plan §3 step 9.
//   - Mode pill uses `<Text inverse>` — structural, per rule 8 "reverse
//     video". No theme colour applies.
//
// Spacing model (mockups.md §15):
//   Inter-binding separator is a base value per tier (2sp full, 1sp short,
//   1sp keys) PLUS any `gapAfter` extra declared by the preceding binding.
//   Category-headered groups get a fixed 3sp gap BEFORE the header plus a
//   2sp gap AFTER the header (wide tier only). Mode pill and prefix gaps
//   are configurable per fixture via props — defaults match the majority
//   of rows in §15; per-mode overrides cover the stragglers.
//
// Width-as-prop rationale: ink-testing-library@4's `render()` does not
// accept a `cols` option; tests pin tiers deterministically via `width`.

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { Binding, AppContext } from "./types.js";
import {
  pickTier,
  filterBindings,
  sortByOrder,
  formatKeys,
  countCategories,
  resolveGapAfter,
  type Tier,
} from "./keybar-layout.js";
import {
  composeKeybarTrailingHint,
  KEYS_TIER_HINT,
} from "./keybar-narrow-hint.js";
import {
  LOG_FOLLOWING_KEYBAR,
  LOG_PAUSED_KEYBAR,
} from "./keybar-fixtures/log.js";

/**
 * Per plan §6.4: when the app is in `viewing.*` with log-pane focus, the
 * keybar auto-swaps its bindings + prefix to match mockups §8 / §9 / §15,
 * regardless of what bindings the caller passed in. `ctx.isFollowing`
 * decides between the LOG_FOLLOWING_KEYBAR / LOG_PAUSED_KEYBAR fixtures.
 */
function selectLogOverride(
  ctx: AppContext,
): {
  readonly bindings: ReadonlyArray<Binding>;
  readonly prefix?: { readonly full: string; readonly short: string };
} | null {
  if (ctx.mode.kind !== "viewing") return null;
  if (ctx.mode.focus !== "log") return null;
  if (ctx.isFollowing) {
    return {
      bindings: LOG_FOLLOWING_KEYBAR,
      prefix: { full: "LOG \u00b7 following", short: "LOG follow" },
    };
  }
  return {
    bindings: LOG_PAUSED_KEYBAR,
    prefix: { full: "LOG \u00b7 paused", short: "LOG paused" },
  };
}

export interface KeybarProps {
  readonly bindings: ReadonlyArray<Binding>;
  readonly ctx: AppContext;
  /** Terminal width in columns. */
  readonly width: number;
  /**
   * Optional mode-pill content (rule 8). The component wraps the string
   * in `[ ... ]` itself. Typical values: "APPROVAL", "RESUME", "COMMAND",
   * "FIND", "HELP".
   */
  readonly modePill?: string;
  /**
   * Tiers on which the mode pill is rendered. Default: `["full", "short"]`
   * — matching APPROVAL/RESUME in mockups.md §15. COMMAND/FIND/HELP only
   * show the pill at `full`, so they pass `["full"]`.
   */
  readonly modePillTiers?: ReadonlyArray<Tier>;
  /**
   * Optional left-side prefix (NOT a pill — no inverse video) rendered
   * before the binding list. Used by the LOG-mode keybar to show
   * "LOG · following" / "LOG follow" / etc. Elided in the keys (<60) tier.
   */
  readonly prefix?: { readonly full: string; readonly short: string };
  /**
   * Gap (in spaces) between the mode pill and the first binding. Keyed by
   * tier. Defaults to 2 (full), 1 (short).
   */
  readonly modePillGap?: {
    readonly full?: number;
    readonly short?: number;
  };
  /**
   * Gap (in spaces) between the prefix string and the first binding. Keyed
   * by tier. Defaults to 3 (full), 2 (short).
   */
  readonly prefixGap?: {
    readonly full?: number;
    readonly short?: number;
  };
  /**
   * Optional right-side hint for the keys tier. Defaults to
   * `KEYS_TIER_HINT` ("? for labels") per mockups.md §13 line 505 / P8-T2.
   * Pass an explicit empty string to suppress the hint in tests.
   *
   * At the keys tier the hint is right-aligned and only rendered when the
   * composed bindings row leaves at least 4 cols of slack after it — see
   * `composeKeybarTrailingHint` (P8-T2).
   */
  readonly keysTierHint?: string;
}

interface ColoredSegment {
  readonly text: string;
  readonly kind: "key" | "label" | "danger" | "category" | "plain" | "inverse";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitKeyLabel(rendered: string): { key: string; label: string } {
  // `renderableLabel` produces either "KEYS" or "KEYS LABEL" (first space
  // separates). A key like "Ctrl + <r>" contains spaces; we rely on
  // formatKeys being the prefix of the rendered string.
  const firstSpace = rendered.indexOf(" ");
  if (firstSpace < 0) return { key: rendered, label: "" };
  return {
    key: rendered.slice(0, firstSpace),
    label: rendered.slice(firstSpace + 1),
  };
}

function bindingSegments(b: Binding, tier: Tier): ColoredSegment[] {
  const keys = formatKeys(b.keys);
  let label = "";
  if (tier === "full") label = b.label;
  else if (tier === "short" && b.shortLabel) label = b.shortLabel;
  if (b.hideLabelOn && b.hideLabelOn.includes(tier)) label = "";

  if (b.destructive) {
    const text = label ? `${keys} ${label}` : keys;
    return [{ text, kind: "danger" }];
  }
  if (keys.includes(" ")) {
    const parts = splitKeyLabel(`${keys}${label ? ` ${label}` : ""}`);
    const segs: ColoredSegment[] = [{ text: parts.key, kind: "key" }];
    if (parts.label) {
      segs.push({ text: " ", kind: "plain" });
      segs.push({ text: parts.label, kind: "label" });
    }
    return segs;
  }

  const segs: ColoredSegment[] = [{ text: keys, kind: "key" }];
  if (label) {
    segs.push({ text: " ", kind: "plain" });
    segs.push({ text: label, kind: "label" });
  }
  return segs;
}

const BASE_SEP: Record<Tier, number> = { full: 2, short: 1, keys: 1 };

function spaces(n: number): string {
  return n > 0 ? " ".repeat(n) : "";
}

// ---------------------------------------------------------------------------
// KeybarImpl
// ---------------------------------------------------------------------------

function KeybarImpl({
  bindings,
  ctx,
  width,
  modePill,
  modePillTiers,
  prefix,
  modePillGap,
  prefixGap,
  keysTierHint = KEYS_TIER_HINT,
}: KeybarProps): React.ReactElement {
  const theme = useTheme();

  // Plan §6.4: in viewing.* with focus === "log", override the caller's
  // bindings + prefix with the LOG_FOLLOWING / LOG_PAUSED fixtures based
  // on `ctx.isFollowing`. For all other modes/focuses the caller's props
  // are used verbatim (including focus === "graph" / "detail").
  const logOverride = selectLogOverride(ctx);
  const effectiveBindings = logOverride ? logOverride.bindings : bindings;
  const effectivePrefix = logOverride ? logOverride.prefix : prefix;

  const segments = useMemo<ColoredSegment[]>(() => {
    const filtered = filterBindings(effectiveBindings, ctx);
    const sorted = sortByOrder(filtered);
    const catCount = countCategories(sorted);
    const tier = pickTier(width, catCount);

    // Tier-level binding filter: `hideOnTier` lets a fixture encode the
    // narrow-tier drops from mockups.md §15 (e.g. WORKFLOWS `q`; APPROVAL
    // `?`). No implicit rule is applied here.
    const visible = sorted.filter((b) => {
      if (b.hideOnTier && b.hideOnTier.includes(tier)) return false;
      return true;
    });

    const out: ColoredSegment[] = [];

    // --- Prefix / mode pill ------------------------------------------------
    const pillTiers = modePillTiers ?? (["full", "short"] as ReadonlyArray<Tier>);
    const pillGapFull = modePillGap?.full ?? 2;
    const pillGapShort = modePillGap?.short ?? 1;
    const prefixGapFull = prefixGap?.full ?? 3;
    const prefixGapShort = prefixGap?.short ?? 2;

    if (modePill && pillTiers.includes(tier)) {
      out.push({ text: `[${modePill}]`, kind: "inverse" });
      if (visible.length > 0) {
        const gap = tier === "full" ? pillGapFull : pillGapShort;
        out.push({ text: spaces(gap), kind: "plain" });
      }
    } else if (effectivePrefix && tier !== "keys") {
      const text = tier === "full" ? effectivePrefix.full : effectivePrefix.short;
      out.push({ text, kind: "plain" });
      if (visible.length > 0) {
        const gap = tier === "full" ? prefixGapFull : prefixGapShort;
        out.push({ text: spaces(gap), kind: "plain" });
      }
    }

    // --- Binding rendering -------------------------------------------------
    // Separator model (mockups.md §15):
    //   base inter-binding = 2sp (full) / 1sp (short) / 1sp (keys)
    //   plus gapAfter(prev) if any
    //   plus auto category-transition 3sp when cur.category differs from
    //     prev.category (full/short tiers); the full tier additionally
    //     renders `CATEGORY` header followed by 2sp before cur keys.
    //   narrow-tier `narrowSeparator` on cur (e.g. "| ") is appended to
    //     the whitespace separator.
    const base = BASE_SEP[tier];

    for (let i = 0; i < visible.length; i++) {
      const prev = i > 0 ? visible[i - 1]! : null;
      const cur = visible[i]!;

      if (prev !== null) {
        const prevCat = prev.category ?? null;
        const curCat = cur.category ?? null;
        const isCategoryTransition =
          tier !== "keys" && prevCat !== curCat;

        const overrideSep = cur.sepBefore?.[tier];

        if (isCategoryTransition) {
          const gap = overrideSep !== undefined ? overrideSep : 3;
          out.push({ text: spaces(gap), kind: "plain" });
          if (tier === "full" && curCat !== null) {
            out.push({ text: curCat, kind: "category" });
            out.push({ text: spaces(2), kind: "plain" });
          }
        } else {
          const extra = resolveGapAfter(prev, tier);
          const sep = overrideSep !== undefined ? overrideSep : base + extra;
          out.push({ text: spaces(sep), kind: "plain" });
          if (tier === "keys" && cur.narrowSeparator) {
            out.push({ text: cur.narrowSeparator, kind: "plain" });
          }
        }
      }

      for (const s of bindingSegments(cur, tier)) out.push(s);
    }

    return out;
  }, [effectiveBindings, ctx, width, modePill, modePillTiers, effectivePrefix, modePillGap, prefixGap]);

  const currentTier = pickTier(
    width,
    countCategories(filterBindings(effectiveBindings, ctx)),
  );
  // Measured row length (post ANSI-stripped, but our segments carry only
  // plain text — the ANSI wrappers Ink applies at render time aren't in
  // this sum, which is what we want for pure text accounting).
  const rowLen = segments.reduce((n, s) => n + s.text.length, 0);
  // P8-T2: gate the right-side hint on slack availability. For the default
  // `? for labels` hint we delegate to the pure helper; for a caller-
  // supplied custom string we apply the same slack rule symmetrically so
  // bespoke hints don't overrun narrow widths.
  const defaultHint = keysTierHint === KEYS_TIER_HINT;
  let showKeysHint: boolean;
  if (currentTier !== "keys" || keysTierHint.length === 0) {
    showKeysHint = false;
  } else if (defaultHint) {
    showKeysHint =
      composeKeybarTrailingHint(currentTier, width, rowLen) !== null;
  } else {
    // Custom hint — 4-col slack rule applied against caller's string length.
    showKeysHint = width - rowLen - 4 >= keysTierHint.length;
  }

  // When the keys-tier hint is active, right-align via flex
  // `justifyContent="space-between"` at the terminal width (P8-T2 §2.4).
  const rowJustify =
    showKeysHint && currentTier === "keys" ? "space-between" : undefined;
  const rowWidth = rowJustify ? width : undefined;

  return (
    <Box flexDirection="row" justifyContent={rowJustify} width={rowWidth}>
      <Box>
        {segments.map((s, idx) => {
          if (s.kind === "category") {
            return (
              <Text
                key={idx}
                bold
                dimColor={theme.colors.dim.dim === true}
                color={theme.colors.dim.color}
              >
                {s.text}
              </Text>
            );
          }
          if (s.kind === "key") {
            return (
              <Text
                key={idx}
                bold
                color={theme.colors.accent.color}
                dimColor={theme.colors.accent.dim === true}
              >
                {s.text}
              </Text>
            );
          }
          if (s.kind === "danger") {
            return (
              <Text
                key={idx}
                color={theme.colors.danger.color}
                dimColor={theme.colors.danger.dim === true}
              >
                {s.text}
              </Text>
            );
          }
          if (s.kind === "inverse") {
            return (
              <Text key={idx} inverse>
                {s.text}
              </Text>
            );
          }
          if (s.kind === "label") {
            return <Text key={idx}>{s.text}</Text>;
          }
          return <Text key={idx}>{s.text}</Text>;
        })}
      </Box>
      {showKeysHint ? (
        <Box marginLeft={1}>
          <Text
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {keysTierHint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const Keybar = React.memo(KeybarImpl);
Keybar.displayName = "Keybar";
