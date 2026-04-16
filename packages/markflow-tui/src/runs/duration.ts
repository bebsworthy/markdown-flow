// src/runs/duration.ts
//
// TUI-local mirror of the subset of engine `parseDuration` grammar needed
// by the runs-table filter bar (P5-T2). Never throws — the filter UI
// treats malformed input as an annotated "malformed" term rather than a
// crash. See docs/tui/plans/P5-T2.md §12 risk 1 for the mirror-vs-export
// decision rationale.
//
// Grammar (subset of packages/markflow/src/core/duration.ts):
//   Pattern: /^(\d+[smhd])+$/ after trimming + lowercasing.
//   Units: s=1000, m=60_000, h=3_600_000, d=86_400_000.
//     - `d` (days) is TUI-only. Engine doesn't recognise it; promoting +
//       extending the engine grammar would couple CLI release cycles to a
//       UI feature (plan §12).
//   `0` is rejected — `since:0s` is nonsense for a filter.
//
// PURITY NOTE: no ink/react/node:* imports. Zero runtime deps.

const UNIT_MS: Readonly<Record<string, number>> = Object.freeze({
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
});

const TOKEN_RE = /(\d+)([smhd])/g;

/**
 * Parse a human-readable duration string into milliseconds. Returns
 * `null` (rather than throwing) on any failure. Accepts concatenated
 * unit tokens: `"30s"`, `"5m"`, `"1h"`, `"2d"`, `"1h30m"`, `"2h15m30s"`.
 *
 * Rejects: empty string, `"0s"`, missing unit, decimals, trailing
 * garbage, unknown units.
 */
export function tryParseDurationMs(input: string): number | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  let total = 0;
  let consumed = 0;
  TOKEN_RE.lastIndex = 0;
  for (const match of trimmed.matchAll(TOKEN_RE)) {
    const amount = Number(match[1]);
    const unit = match[2]!;
    const unitMs = UNIT_MS[unit];
    if (unitMs == null || !Number.isFinite(amount)) return null;
    total += amount * unitMs;
    consumed += match[0].length;
  }

  if (consumed !== trimmed.length) return null;
  if (total <= 0) return null;
  return total;
}
