// src/add-modal/fuzzy.ts
//
// Pure fuzzy scorer + ranker for add-modal candidate filtering (P4-T3).
//
// Authoritative references:
//   - docs/tui/plans/P4-T3.md §5.2.
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Registered in
// test/state/purity.test.ts as a pure module.

import type { Candidate, RankedCandidate } from "./types.js";

/** Default cap on returned ranked candidates — keeps downstream render cheap. */
const DEFAULT_LIMIT = 50;

/**
 * Compute a fuzzy match score of `query` against `text`.
 *
 * Scoring (all integer, higher = better):
 *   base            = match count (one point per matched query char)
 *   consecutive run = +4 per query char that follows its predecessor by one
 *   prefix bonus    = +10 when query[0] matches text[0]
 *   basename hit    = +20 when every matched position lies past the last
 *                     `/` or `\` in text (i.e. within the basename)
 *   case-sensitive  = +2 when a matched char is exactly-case equal
 *
 * Empty query short-circuits to { score: 0, positions: [] }. A query that
 * is not a (case-folded) subsequence of `text` returns `null`.
 *
 * Deterministic — same input → same output.
 */
export function scoreSubsequence(
  query: string,
  text: string,
): { score: number; positions: ReadonlyArray<number> } | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]!;
    while (ti < t.length && t[ti] !== qc) ti++;
    if (ti >= t.length) return null;
    positions.push(ti);
    ti++;
  }
  let score = positions.length;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === positions[i - 1]! + 1) score += 4;
  }
  if (positions[0] === 0) score += 10;
  const lastSlash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  if (positions.every((p) => p > lastSlash)) score += 20;
  for (let i = 0; i < positions.length; i++) {
    const tp = text[positions[i]!];
    const qp = query[i];
    if (tp !== undefined && qp !== undefined && tp === qp) score += 2;
  }
  return { score, positions };
}

/**
 * Rank candidates by fuzzy match quality.
 *
 * Behaviour:
 *   - Empty query → returns `candidates` in original order, score 0,
 *     truncated to `limit`. No reordering.
 *   - Non-matches (query is not a subsequence of displayPath) are dropped.
 *   - Sort order: score desc, then `displayPath` lexicographic asc (stable
 *     tie-break that preserves insertion order among equal keys).
 *   - Result length capped at `limit` (default 50).
 *
 * Deterministic — safe to call during render via `useMemo`.
 */
export function rankCandidates(
  query: string,
  candidates: ReadonlyArray<Candidate>,
  limit?: number,
): ReadonlyArray<RankedCandidate> {
  const cap = limit ?? DEFAULT_LIMIT;
  if (query.length === 0) {
    const out: RankedCandidate[] = [];
    for (let i = 0; i < candidates.length && i < cap; i++) {
      out.push({
        candidate: candidates[i]!,
        score: 0,
        matchPositions: [],
      });
    }
    return out;
  }

  const scored: Array<RankedCandidate & { order: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const res = scoreSubsequence(query, cand.displayPath);
    if (res === null) continue;
    scored.push({
      candidate: cand,
      score: res.score,
      matchPositions: res.positions,
      order: i,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = a.candidate.displayPath;
    const pb = b.candidate.displayPath;
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return a.order - b.order;
  });

  const out: RankedCandidate[] = [];
  for (let i = 0; i < scored.length && i < cap; i++) {
    const s = scored[i]!;
    out.push({
      candidate: s.candidate,
      score: s.score,
      matchPositions: s.matchPositions,
    });
  }
  return out;
}
