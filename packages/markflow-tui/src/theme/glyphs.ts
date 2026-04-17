// src/theme/glyphs.ts

import type { ColorRole } from "./tokens.js";

/**
 * Box-drawing frame glyphs. Used by the app-shell (P3-T5) to render the
 * outer `╔═══╗` frame and the mid splitter row. Keyed by geometric role:
 *
 *   tl ─ top-left corner            ╔ / +
 *   tr ─ top-right corner           ╗ / +
 *   bl ─ bottom-left corner         ╚ / +
 *   br ─ bottom-right corner        ╝ / +
 *   h  ─ horizontal edge fill       ═ / -
 *   v  ─ vertical edge fill         ║ / |
 *   mid_l ─ left T-splitter         ╠ / +
 *   mid_r ─ right T-splitter        ╣ / +
 *   mid_h ─ horizontal mid fill     ═ / -   (equal to h; split for symmetry)
 *
 * Selection is capability-driven via `buildTheme(capabilities)` — see
 * theme.ts.
 */
export interface FrameGlyphs {
  readonly tl: string;
  readonly tr: string;
  readonly bl: string;
  readonly br: string;
  readonly h: string;
  readonly v: string;
  readonly mid_l: string;
  readonly mid_r: string;
  readonly mid_h: string;
}

/** Unicode box-drawing frame glyphs (default). */
export const UNICODE_FRAME: FrameGlyphs = Object.freeze({
  tl: "\u2554", // ╔
  tr: "\u2557", // ╗
  bl: "\u255A", // ╚
  br: "\u255D", // ╝
  h: "\u2550",  // ═
  v: "\u2551",  // ║
  mid_l: "\u2560", // ╠
  mid_r: "\u2563", // ╣
  mid_h: "\u2550", // ═
});

/** ASCII fallback frame glyphs. */
export const ASCII_FRAME: FrameGlyphs = Object.freeze({
  tl: "+",
  tr: "+",
  bl: "+",
  br: "+",
  h: "-",
  v: "|",
  mid_l: "+",
  mid_r: "+",
  mid_h: "-",
});

/**
 * The 10 status glyphs from docs/tui/features.md §5.10 (line 529–540),
 * keyed by state name. The task brief (plan.md line 294) enumerates the
 * same 10 characters: ⊙ ▶ ✓ ✗ ○ ⏸ ↻ ⏱ ⟳ →.
 *
 * Plus two progress-bar block glyphs added in P6-T1 (docs/tui/plans/P6-T1.md
 * §4.4 + §12.6) for the forEach batch aggregate row: `progressFilled` (█)
 * and `progressEmpty` (░). They degrade to `#` / `.` in the ASCII tier.
 * The progress bar is the first non-status glyph we added — it belongs
 * with the rest of the theme glyphs so capability-driven ASCII fallback
 * flows through `buildTheme(capabilities).glyphs`.
 */
export type GlyphKey =
  | "pending"         // ⊙
  | "running"         // ▶
  | "ok"              // ✓           ("complete" state)
  | "fail"            // ✗           ("failed"   state)
  | "skipped"         // ○
  | "waiting"         // ⏸           (approval / suspended)
  | "retry"           // ↻
  | "timeout"         // ⏱
  | "batch"           // ⟳
  | "arrow"           // →           (route / edge glyph)
  | "progressFilled"  // █           (P6-T1 forEach aggregate progress bar)
  | "progressEmpty";  // ░           (P6-T1 forEach aggregate progress bar)

export type GlyphTable = Readonly<Record<GlyphKey, string>>;

/**
 * Unicode glyph table — the default full-fat renderings from §5.10 plus
 * the two progress-bar block glyphs (P6-T1).
 */
export const UNICODE_GLYPHS: GlyphTable = Object.freeze({
  pending: "⊙",
  running: "▶",
  ok: "✓",
  fail: "✗",
  skipped: "○",
  waiting: "⏸",
  retry: "↻",
  timeout: "⏱",
  batch: "⟳",
  arrow: "→",
  progressFilled: "█",
  progressEmpty: "░",
});

/**
 * ASCII fallback table — used when MARKFLOW_ASCII=1 or when the terminal
 * is not detected as UTF-8-capable. Notes:
 * - `pending` uses `[pend]` rather than `[wait]` to avoid colliding with
 *   the approval/suspended `waiting` state. See docs/tui/plans/P3-T3.md §3.3.
 * - `arrow` uses `->` per plan.md line 294.
 * - `progressFilled` / `progressEmpty` fall back to `#` / `.` (P6-T1).
 */
export const ASCII_GLYPHS: GlyphTable = Object.freeze({
  pending: "[pend]",
  running: "[run]",
  ok: "[ok]",
  fail: "[fail]",
  skipped: "[skip]",
  waiting: "[wait]",
  retry: "[retry]",
  timeout: "[time]",
  batch: "[batch]",
  arrow: "->",
  progressFilled: "#",
  progressEmpty: ".",
});

/** Maps a semantic `ColorRole` to its corresponding `GlyphKey`. */
export function glyphKeyForRole(role: ColorRole): GlyphKey {
  switch (role) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "complete":
      return "ok";
    case "failed":
      return "fail";
    case "skipped":
      return "skipped";
    case "waiting":
      return "waiting";
    case "retrying":
      return "retry";
    case "timeout":
      return "timeout";
    case "batch":
      return "batch";
    case "route":
      return "arrow";
    // Chrome roles (accent, dim, danger) have no glyph. Throwing here
    // surfaces wiring bugs at dev time rather than silently returning
    // an arbitrary fallback.
    case "accent":
    case "dim":
    case "danger":
      throw new Error(
        `glyphKeyForRole: no glyph for chrome role "${role}"`,
      );
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
