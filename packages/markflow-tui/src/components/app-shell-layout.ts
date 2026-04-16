// src/components/app-shell-layout.ts
//
// Pure layout helpers for the <AppShell> + <ModeTabs> components (P3-T5).
//
// PURITY NOTE: this module MUST NOT import from `react`, `ink`, `node:*`,
// `fs`, `path`, or any I/O/rendering surface. It declares types and pure
// functions only. Registered in test/state/purity.test.ts.
//
// Authoritative references:
//   - docs/tui/plans/P3-T5.md §4 (Pure helpers)
//   - docs/tui/features.md §5.6 rule 5 (hide-don't-grey), rule 8 (mode pill)
//   - docs/tui/mockups.md §1, §4, §14
//
// Only type-only imports are used from state/theme modules, so no runtime
// coupling crosses the purity boundary.

import type { Action, AppState } from "../state/types.js";
import type { FrameGlyphs } from "../theme/glyphs.js";

/** Symbolic name for one of the three top-level mode tabs. */
export type ModeTabKey = "WORKFLOWS" | "RUNS" | "RUN";

/**
 * A single keystroke projected from Ink's `useInput((input, key) => ...)`.
 * Only the fields the helper needs are carried — keeps the surface small
 * and the test fixtures trivial.
 *
 * Ink 5's `Key` type does NOT expose explicit F-key flags; F-keys arrive as
 * raw ANSI escape sequences in `input` (e.g. `\x1bOP` for F1). Callers
 * either:
 *   - set `f1`/`f2`/`f3` explicitly (for synthetic tests), OR
 *   - pass the raw `input` string — `keyToMode` detects the F-key escape
 *     codes directly.
 */
export interface KeyEvent {
  readonly input: string;
  readonly f1?: boolean;
  readonly f2?: boolean;
  readonly f3?: boolean;
}

/**
 * ANSI escape sequences for F1/F2/F3. Multiple forms are emitted by
 * different terminals:
 *   xterm-style SS3: `\x1bOP` / `\x1bOQ` / `\x1bOR`
 *   VT220-style CSI: `\x1b[[A` / `\x1b[[B` / `\x1b[[C`
 *   modern CSI:      `\x1b[11~` / `\x1b[12~` / `\x1b[13~`
 * We recognise all three — the SS3 form is the common default on macOS
 * Terminal / iTerm / most emulators, but shells and multiplexers may emit
 * any of the other variants.
 */
const F1_SEQS: ReadonlyArray<string> = ["\x1bOP", "\x1b[[A", "\x1b[11~"];
const F2_SEQS: ReadonlyArray<string> = ["\x1bOQ", "\x1b[[B", "\x1b[12~"];
const F3_SEQS: ReadonlyArray<string> = ["\x1bOR", "\x1b[[C", "\x1b[13~"];

function isF1(ev: KeyEvent): boolean {
  return ev.f1 === true || F1_SEQS.includes(ev.input);
}
function isF2(ev: KeyEvent): boolean {
  return ev.f2 === true || F2_SEQS.includes(ev.input);
}
function isF3(ev: KeyEvent): boolean {
  return ev.f3 === true || F3_SEQS.includes(ev.input);
}

/**
 * Visual style descriptor for a mode-tab label. The `inverse` field is
 * structural per features.md §5.6 rule 8 (reverse video); no theme color
 * applies. The caller (`ModeTabs` component) reads these booleans and
 * maps them onto `<Text inverse bold>` props.
 */
export interface TabStyle {
  readonly inverse: boolean;
  readonly bold: boolean;
}

// ---------------------------------------------------------------------------
// activeTabFromMode
// ---------------------------------------------------------------------------

/**
 * Maps the current `AppState.mode` onto the active tab key.
 *
 *   browsing.workflows → "WORKFLOWS"
 *   browsing.runs      → "RUNS"
 *   viewing(...)       → "RUN"
 */
export function activeTabFromMode(mode: AppState["mode"]): ModeTabKey {
  if (mode.kind === "viewing") return "RUN";
  if (mode.pane === "runs") return "RUNS";
  return "WORKFLOWS";
}

// ---------------------------------------------------------------------------
// keyToMode
// ---------------------------------------------------------------------------

/**
 * Pure key-to-action mapper. Given a keystroke and a minimal slice of state
 * context, returns the action to dispatch — or `null` if the key is not
 * bound in the current context (hide-don't-grey, features.md §5.6 rule 5).
 *
 * Handled keys:
 *   - F1 / "1"  → MODE_SHOW_WORKFLOWS
 *   - F2 / "2"  → MODE_SHOW_RUNS
 *   - F3 / "3"  → MODE_OPEN_RUN({ runId: selectedRunId }) if a run is
 *                 selectable; null if already viewing or no run is selected.
 *
 * All other keys return null.
 */
export function keyToMode(
  ev: KeyEvent,
  ctx: {
    readonly mode: AppState["mode"];
    readonly selectedRunId: string | null;
  },
): Action | null {
  const hitF1 = isF1(ev) || ev.input === "1";
  const hitF2 = isF2(ev) || ev.input === "2";
  const hitF3 = isF3(ev) || ev.input === "3";

  if (hitF1) return { type: "MODE_SHOW_WORKFLOWS" };
  if (hitF2) return { type: "MODE_SHOW_RUNS" };
  if (hitF3) {
    // Already viewing a run — F3 is a no-op.
    if (ctx.mode.kind === "viewing") return null;
    // Hide-don't-grey: F3 is silently unbound when no run is selected.
    if (ctx.selectedRunId === null) return null;
    return { type: "MODE_OPEN_RUN", runId: ctx.selectedRunId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// frameTitle
// ---------------------------------------------------------------------------

const ALL_TABS: ReadonlyArray<ModeTabKey> = ["WORKFLOWS", "RUNS", "RUN"];

/**
 * Returns the frame title row text given the active tab.
 *
 * - Inactive tabs render as plain uppercase labels.
 * - The active tab is wrapped in `[ ... ]` brackets.
 * - Tabs are separated by two spaces (mockups.md §1 / §4 convention).
 * - `hideRun: true` omits the RUN tab entirely — used when no run is
 *   selected (hide-don't-grey, features.md §5.6 rule 5).
 *
 * The helper does NOT wrap anything in ANSI codes; inverse-video styling
 * lives in the React layer (`<Text inverse>`).
 */
export function frameTitle(
  active: ModeTabKey,
  opts?: { readonly hideRun?: boolean },
): string {
  const hideRun = opts?.hideRun === true;
  const tabs = hideRun ? ALL_TABS.filter((t) => t !== "RUN") : ALL_TABS;
  return tabs
    .map((t) => (t === active ? `[ ${t} ]` : t))
    .join("  ");
}

// ---------------------------------------------------------------------------
// pickActiveTabStyle
// ---------------------------------------------------------------------------

/**
 * Returns `{ inverse: true, bold: true }` for the active tab and
 * `{ inverse: false, bold: false }` for every other tab.
 */
export function pickActiveTabStyle(
  tab: ModeTabKey,
  active: ModeTabKey,
): TabStyle {
  const isActive = tab === active;
  return { inverse: isActive, bold: isActive };
}

// ---------------------------------------------------------------------------
// composeTopRow
// ---------------------------------------------------------------------------

const ELLIPSIS = "\u2026"; // …

/**
 * Composes the entire top row of the frame given width, title text, and
 * the frame glyph table. The row has the shape:
 *
 *   <tl> <title> <h...h> <tr>
 *
 * with a single space of padding between the title and the left/right
 * glyphs — matching mockups.md §1 line 14 (`╔ WORKFLOWS  RUNS  RUN ═══╗`).
 *
 * Defensive truncation: if the title does not fit inside the inner area
 * (width - 4: two corners + two spaces), it is truncated with a single-
 * character ellipsis ('…'). Callers should not normally hit this path at
 * the ≥60 column widths supported in-task; narrow-tier polish is P8-T2.
 */
export function composeTopRow(
  width: number,
  title: string,
  glyphs: FrameGlyphs,
): string {
  if (width < 2) return "";
  if (width === 2) return `${glyphs.tl}${glyphs.tr}`;

  // Inner width available for content between corners.
  const innerWidth = width - 2;

  // Degenerate: nothing fits. Just corners filled with horizontal fill.
  if (innerWidth < 4) {
    return `${glyphs.tl}${glyphs.h.repeat(innerWidth)}${glyphs.tr}`;
  }

  // Reserve one space on each side of the title.
  const maxTitleLen = innerWidth - 2;
  let rendered = title;
  if (rendered.length > maxTitleLen) {
    // Truncate with ellipsis (defensive — see §9 risk 8).
    if (maxTitleLen <= 1) {
      rendered = ELLIPSIS;
    } else {
      rendered = rendered.slice(0, maxTitleLen - 1) + ELLIPSIS;
    }
  }

  const padCount = innerWidth - 2 - rendered.length; // spaces already accounted
  const pad = padCount > 0 ? glyphs.h.repeat(padCount) : "";

  return `${glyphs.tl} ${rendered} ${pad}${glyphs.tr}`;
}

// ---------------------------------------------------------------------------
// pickFrameSlots
// ---------------------------------------------------------------------------

/**
 * Computes top-half and bottom-half row counts given total terminal rows.
 * Reserves 4 rows of chrome (top edge + splitter + bottom edge + keybar).
 *
 * Degenerate clamp: if fewer than 6 rows are available, both slots clamp
 * to a single row each. (At 6 total rows we already allocate 2 slot rows;
 * below that we preserve the single-row minimum for both so children can
 * render something.)
 */
export function pickFrameSlots(
  rows: number,
): { readonly topRows: number; readonly bottomRows: number } {
  if (rows < 6) {
    return { topRows: 1, bottomRows: 1 };
  }
  const content = rows - 4;
  const topRows = Math.floor(content / 2);
  const bottomRows = content - topRows;
  return { topRows, bottomRows };
}
