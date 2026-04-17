// src/components/narrow-layout.ts
//
// Pure helpers for the <60-col single-pane layout.
//
// Authoritative references:
//   - docs/tui/mockups.md §13 (narrow layout reference at 52 cols)
//   - docs/tui/plans/P8-T2.md §2.1
//   - docs/tui/features.md §5.4, §5.6 rule 7
//
// PURITY NOTE: no react/ink/node:* imports. Registered in
// test/state/purity.test.ts.

/** Exclusive upper bound of the narrow tier. `width < NARROW_TIER_MAX` → narrow. */
export const NARROW_TIER_MAX = 60;

/**
 * Three drill levels at narrow width (mockups.md §13 lines 508–510):
 *   "runs"       — top-level runs table (starts here on entry to RUNS mode)
 *   "steplist"   — one run's step table (after Enter on a run row)
 *   "stepdetail" — one step's detail view (after Enter on a step row; the
 *                  Graph/Detail/Log/Events tab row still appears at the top)
 */
export type NarrowLevel = "runs" | "steplist" | "stepdetail";

/**
 * Minimal view onto `AppState` needed to pick a narrow level. Stays a
 * structural subset so the helper is trivially unit-testable without
 * fabricating full `AppState` objects.
 */
export interface NarrowLevelInput {
  readonly mode:
    | { readonly kind: "browsing"; readonly pane: "workflows" | "runs" }
    | { readonly kind: "viewing"; readonly runId: string; readonly focus: string };
  readonly selectedStepId: string | null;
}

/**
 * Resolves the narrow level from the existing app mode + selection. Does
 * NOT introduce a new state kind.
 *
 *   mode.kind === "browsing" && mode.pane === "runs"          → "runs"
 *   mode.kind === "viewing"  && selectedStepId == null        → "steplist"
 *   mode.kind === "viewing"  && selectedStepId != null        → "stepdetail"
 *   otherwise (browsing.workflows etc.)                       → null
 *
 * Returning null signals "the narrow single-pane rewrite doesn't apply
 * here" — the caller should fall back to its non-narrow render path. This
 * keeps the workflow browser, overlays, and error screens untouched.
 */
export function pickNarrowLevel(input: NarrowLevelInput): NarrowLevel | null {
  const { mode, selectedStepId } = input;
  if (mode.kind === "browsing") {
    if (mode.pane === "runs") return "runs";
    return null;
  }
  if (mode.kind === "viewing") {
    return selectedStepId == null ? "steplist" : "stepdetail";
  }
  return null;
}

/**
 * Composes the breadcrumb title string shown in the top frame edge in
 * place of the mode tabs. Matches mockups.md §13 line 488:
 *   "Runs › ijkl56 › deploy-us"
 * or at narrow-ASCII:
 *   "Runs -> ijkl56 -> deploy-us"
 *
 * - `separator` is the arrow-like glyph (caller passes the active
 *   theme's `glyphs.arrow`). No theme lookup inside this helper — keeps
 *   it pure for testability.
 * - Trailing segments are omitted (not blanked) when their label is null.
 *   E.g. "runs" level → "Runs".
 * - No truncation here; the caller clamps to the available title width.
 */
export function composeBreadcrumb(
  level: NarrowLevel,
  runLabel: string | null,
  stepLabel: string | null,
  separator: string,
): string {
  const segs: string[] = ["Runs"];
  if (level === "steplist" || level === "stepdetail") {
    if (runLabel != null && runLabel.length > 0) segs.push(runLabel);
  }
  if (level === "stepdetail") {
    if (stepLabel != null && stepLabel.length > 0) segs.push(stepLabel);
  }
  return segs.join(` ${separator} `);
}
