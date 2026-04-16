// src/theme/tokens.ts

/**
 * Status colors — paired 1:1 with the glyphs in src/theme/glyphs.ts.
 * Values cite docs/tui/features.md §5.10 verbatim.
 */
export type StatusRole =
  | "pending"   // §5.10: "dim"
  | "running"   // §5.10: "blue"
  | "complete"  // §5.10: "green"
  | "failed"    // §5.10: "red"
  | "skipped"   // §5.10: "dim grey"
  | "waiting"   // §5.10: "yellow"       (approval-pending)
  | "retrying"  // §5.10: "yellow"
  | "timeout"   // §5.10: "red"
  | "batch"     // §5.10: "magenta"
  | "route";    // §5.10: "dim cyan"

/**
 * Non-status color roles. `accent` is for category headers / active
 * selection chrome; `dim` is for de-emphasised chrome; `danger` is for
 * destructive keybar hints ("X Cancel"). These three roles are named in
 * the P3-T3 task brief; see plan.md line 293.
 */
export type ChromeRole = "accent" | "dim" | "danger";

export type ColorRole = StatusRole | ChromeRole;

/**
 * The rendered color value. `undefined` means "use terminal default /
 * inherit" — the correct signal to Ink's <Text> when NO_COLOR is set.
 * `dim` is a structural property, not a hue, but Ink exposes it via
 * `dimColor`; we encode it as a tuple so renderers know to apply both.
 */
export interface ColorSpec {
  readonly color?: string; // named color, e.g. "green", or undefined
  readonly dim?: boolean; // applies <Text dimColor>
}

export type ColorTable = Readonly<Record<ColorRole, ColorSpec>>;

/** Full-color table for capable terminals. Named colors only — they
 *  degrade gracefully on 8-color terminals. */
export const COLOR_TABLE: ColorTable = Object.freeze({
  // status
  pending: { dim: true }, // "dim"
  running: { color: "blue" },
  complete: { color: "green" },
  failed: { color: "red" },
  skipped: { color: "gray", dim: true }, // "dim grey"
  waiting: { color: "yellow" },
  retrying: { color: "yellow" },
  timeout: { color: "red" },
  batch: { color: "magenta" },
  route: { color: "cyan", dim: true }, // "dim cyan"
  // chrome
  accent: { color: "cyan" },
  dim: { dim: true },
  danger: { color: "red" },
});

/**
 * Monochrome table — used when NO_COLOR or TERM=dumb is detected.
 * Every role maps to "inherit" (empty ColorSpec). Consumers must still
 * pair the role with a glyph and a text label, per features.md §5.10:
 * "Every state-encoding color is paired with a glyph and a text label
 *  in the detail pane."
 */
export const MONOCHROME_COLOR_TABLE: ColorTable = Object.freeze({
  pending: {},
  running: {},
  complete: {},
  failed: {},
  skipped: {},
  waiting: {},
  retrying: {},
  timeout: {},
  batch: {},
  route: {},
  accent: {},
  dim: {},
  danger: {},
});
