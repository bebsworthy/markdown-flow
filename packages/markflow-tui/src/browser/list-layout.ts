// src/browser/list-layout.ts
//
// Pure list-row composition for the workflow browser's left pane. No
// React, no Ink, no node:*, no fs. Enforced by `test/state/purity.test.ts`.
//
// Authoritative references:
//   - docs/tui/features.md §3.1 (Display paragraph)
//   - docs/tui/mockups.md §2 (rows 52-72)
//   - docs/tui/plans/P4-T2.md §2.3

import { formatSourceBadge, formatStatusFlag } from "./preview-layout.js";
import type { ResolvedEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListRow {
  readonly id: string;
  readonly cursorGlyph: string;   // "▶ " on selected row, "  " otherwise.
  readonly sourceText: string;    // padded to `sourceColumnWidth`.
  readonly badgeText: string;     // padded to `badgeColumnWidth`.
  readonly flagText: string;      // trailing, unpadded (fits the row).
  readonly flagTone: "good" | "bad" | "neutral";
  readonly isSelected: boolean;
  readonly status: ResolvedEntry["status"];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_ACTIVE = "▶ ";
const CURSOR_INACTIVE = "  ";
const MIN_BADGE_WIDTH = 12;
const MAX_BADGE_WIDTH = 18;
const MIDDLE_ELLIPSIS = "…";
const MIN_MIDDLE_ELLIPSIS_LENGTH = 20;
const MIN_FLAG_WIDTH = 7; // enough for "✓ 99h" + space

// ---------------------------------------------------------------------------
// pickBadgeColumnWidth
// ---------------------------------------------------------------------------

/**
 * Compute the width of the `[badge]` column given the entries in view.
 * Never narrower than MIN_BADGE_WIDTH (12), never wider than MAX_BADGE_WIDTH (18).
 */
export function pickBadgeColumnWidth(
  entries: ReadonlyArray<ResolvedEntry>,
): number {
  let longest = 0;
  for (const e of entries) {
    const badge = formatSourceBadge(e);
    if (badge.length > longest) longest = badge.length;
  }
  // Column width is badge-length + 1 trailing space — we want the min to be 12
  // regardless of contents so single "[file]" rows still line up when mixed.
  const raw = longest + 1;
  if (raw < MIN_BADGE_WIDTH) return MIN_BADGE_WIDTH;
  if (raw > MAX_BADGE_WIDTH) return MAX_BADGE_WIDTH;
  return raw;
}

// ---------------------------------------------------------------------------
// truncateSource
// ---------------------------------------------------------------------------

/**
 * Truncate `src` to fit in `maxWidth` columns. Strings shorter than
 * `MIN_MIDDLE_ELLIPSIS_LENGTH` (20) get a right-truncation with an ellipsis;
 * longer strings get a middle ellipsis that preserves the prefix and the
 * basename tail, which is usually the most identifying information.
 */
export function truncateSource(src: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (src.length <= maxWidth) return src;
  if (maxWidth <= 1) return MIDDLE_ELLIPSIS;

  if (src.length < MIN_MIDDLE_ELLIPSIS_LENGTH || maxWidth < 8) {
    // Simple right-truncation with ellipsis.
    return src.slice(0, Math.max(0, maxWidth - 1)) + MIDDLE_ELLIPSIS;
  }

  // Middle ellipsis: keep prefix + "…" + basename.
  const basenameMatch = src.match(/[^/\\]+$/);
  const basename = basenameMatch ? basenameMatch[0] : "";
  const keepTail = Math.min(basename.length, Math.max(4, Math.floor(maxWidth / 2)));
  const tail = basename.slice(basename.length - keepTail);
  const prefixBudget = Math.max(1, maxWidth - tail.length - 1);
  const prefix = src.slice(0, prefixBudget);
  return `${prefix}${MIDDLE_ELLIPSIS}${tail}`;
}

// ---------------------------------------------------------------------------
// formatListTitle
// ---------------------------------------------------------------------------

/**
 * Title bar text for the list pane. When `registryPath` is non-null, render
 * a relative path if within cwd, else the absolute path. `null` means
 * `--no-save` mode.
 */
export function formatListTitle(
  registryPath: string | null,
  cwd: string,
): string {
  if (registryPath === null) return "Workflows  (session only)";
  const displayed = pathRelativeToCwd(registryPath, cwd);
  return `Workflows  (${displayed})`;
}

function pathRelativeToCwd(p: string, cwd: string): string {
  if (!cwd || cwd.length === 0) return p;
  const normalized = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (p.startsWith(normalized)) {
    return `./${p.slice(normalized.length)}`;
  }
  if (p === cwd) return "./";
  return p;
}

// ---------------------------------------------------------------------------
// formatListFooter
// ---------------------------------------------------------------------------

/**
 * Footer text beneath the list. Format:
 *   "5 entries · 1 error"
 *   "5 entries"
 *   "0 entries"
 */
export function formatListFooter(
  entries: ReadonlyArray<ResolvedEntry>,
): string {
  const total = entries.length;
  let errors = 0;
  for (const e of entries) {
    if (e.status === "parse-error" || e.status === "missing") errors += 1;
  }
  const base = `${total} ${total === 1 ? "entry" : "entries"}`;
  if (errors === 0) return base;
  return `${base} · ${errors} ${errors === 1 ? "error" : "errors"}`;
}

// ---------------------------------------------------------------------------
// composeListRows
// ---------------------------------------------------------------------------

/**
 * Compose the full list of rows for the left pane. Takes resolved entries,
 * the selected index (or -1 for none), and the pane width; returns one row
 * per entry, padded so columns align.
 */
export function composeListRows(
  entries: ReadonlyArray<ResolvedEntry>,
  selectedIndex: number,
  paneWidth: number,
  now?: number,
): ReadonlyArray<ListRow> {
  if (entries.length === 0) return [];
  const badgeCol = pickBadgeColumnWidth(entries);
  // Reserve columns for cursor glyph ("▶ ") + badge column + flag column.
  const flagBudget = Math.max(0, Math.min(MIN_FLAG_WIDTH, paneWidth));
  const cursorBudget = CURSOR_ACTIVE.length; // 2
  const sourceBudget = Math.max(
    0,
    paneWidth - cursorBudget - badgeCol - flagBudget - 1,
  );

  const rows: ListRow[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const isSelected = i === selectedIndex;
    const cursorGlyph = isSelected ? CURSOR_ACTIVE : CURSOR_INACTIVE;
    const rawSource = e.title;
    const sourceDisplay = truncateSource(rawSource, sourceBudget);
    const sourceText = sourceDisplay.padEnd(sourceBudget);
    const badgeRaw = formatSourceBadge(e);
    const badgeText = badgeRaw.padEnd(badgeCol);
    const flag = formatStatusFlag(e, now);
    const flagText = flag.text.length > flagBudget
      ? flag.text.slice(0, Math.max(0, flagBudget))
      : flag.text;
    rows.push({
      id: e.id,
      cursorGlyph,
      sourceText,
      badgeText,
      flagText,
      flagTone: flag.tone,
      isSelected,
      status: e.status,
    });
  }
  return rows;
}

/**
 * Returns the cursor glyph for a row at the given index given `selectedIndex`.
 * Public only because tests sometimes want to assert the value without going
 * through `composeListRows`.
 */
export function computeCursorGlyph(
  index: number,
  selectedIndex: number,
): string {
  return index === selectedIndex ? CURSOR_ACTIVE : CURSOR_INACTIVE;
}
