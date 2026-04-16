// src/theme/glyphs.ts

import type { ColorRole } from "./tokens.js";

/**
 * The 10 glyphs from docs/tui/features.md §5.10 (line 529–540), keyed by
 * state name. The task brief (plan.md line 294) enumerates the same 10
 * characters: ⊙ ▶ ✓ ✗ ○ ⏸ ↻ ⏱ ⟳ →.
 */
export type GlyphKey =
  | "pending"   // ⊙
  | "running"   // ▶
  | "ok"        // ✓           ("complete" state)
  | "fail"      // ✗           ("failed"   state)
  | "skipped"   // ○
  | "waiting"   // ⏸           (approval / suspended)
  | "retry"     // ↻
  | "timeout"   // ⏱
  | "batch"     // ⟳
  | "arrow";    // →           (route / edge glyph)

export type GlyphTable = Readonly<Record<GlyphKey, string>>;

/**
 * Unicode glyph table — the default full-fat renderings from §5.10.
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
});

/**
 * ASCII fallback table — used when MARKFLOW_ASCII=1 or when the terminal
 * is not detected as UTF-8-capable. Notes:
 * - `pending` uses `[pend]` rather than `[wait]` to avoid colliding with
 *   the approval/suspended `waiting` state. See docs/tui/plans/P3-T3.md §3.3.
 * - `arrow` uses `->` per plan.md line 294.
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
