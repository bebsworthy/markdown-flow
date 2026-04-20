// src/runs/filter.ts
//
// Pure filter pipeline for the runs table (P5-T2).
//
// Responsibilities:
//   - parseFilterInput(raw) — lex + classify into RunsFilterTerm[].
//   - applyFilter(rows, filter) — AND-combine non-malformed term predicates.
//   - isArchived(info, policy, now) — archive predicate (24h/7d by default).
//   - applyArchive(rows, policy, now) — partition into {shown, archived}.
//
// Authoritative references:
//   - docs/tui/features.md §3.2 (Archive handling paragraph, query bar).
//   - docs/tui/plans/P5-T2.md §3 (filter grammar), §4 (archive policy).
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` and the sibling pure modules.

import type { RunInfo, RunStatus } from "markflow-cli";
import { tryParseDurationMs } from "./duration.js";
import type {
  RunsArchivePolicy,
  RunsFilterInput,
  RunsFilterTerm,
  RunsTableRow,
} from "./types.js";

// ---------------------------------------------------------------------------
// Lexing — split on unquoted whitespace, honour "quoted atoms"
// ---------------------------------------------------------------------------

/**
 * Lex the raw input into atoms. Quoted substrings preserve embedded
 * whitespace and are decoded (surrounding quotes stripped). Unterminated
 * quotes fall back to treating the remainder as a single atom — defensive;
 * never throws.
 */
function lex(raw: string): ReadonlyArray<string> {
  const atoms: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    // Skip whitespace
    while (i < n && (raw[i] === " " || raw[i] === "\t")) i += 1;
    if (i >= n) break;

    if (raw[i] === '"') {
      // Quoted atom — seek closing quote; on EOF, take rest.
      i += 1;
      let start = i;
      while (i < n && raw[i] !== '"') i += 1;
      atoms.push(raw.slice(start, i));
      if (i < n) i += 1; // consume closing quote
      continue;
    }

    // key:"quoted" form — take key up to `:"` and then a quoted tail.
    const start = i;
    while (
      i < n &&
      raw[i] !== " " &&
      raw[i] !== "\t" &&
      raw[i] !== '"'
    ) {
      i += 1;
    }
    if (i < n && raw[i] === '"' && i > start && raw[i - 1] === ":") {
      // consume quoted tail, glue to prefix
      i += 1;
      const tailStart = i;
      while (i < n && raw[i] !== '"') i += 1;
      const tail = raw.slice(tailStart, i);
      if (i < n) i += 1;
      atoms.push(raw.slice(start, tailStart - 1) + tail);
      continue;
    }
    atoms.push(raw.slice(start, i));
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// Term classification
// ---------------------------------------------------------------------------

const STATUS_ALIAS: Readonly<Record<string, RunStatus>> = Object.freeze({
  running: "running",
  complete: "complete",
  error: "error",
  suspended: "suspended",
  ok: "complete",
  failed: "error",
});

function classifyAtom(atom: string): RunsFilterTerm {
  if (atom.length === 0) {
    return { kind: "malformed", raw: atom };
  }

  const lower = atom.toLowerCase();

  // `status:<value>` — first colon only. Anything after the first colon
  // is the tail; a double-colon atom (e.g. "status::running") yields a
  // tail starting with ':' which cannot match a status and therefore
  // falls through to idPrefix per plan §3.2.
  if (lower.startsWith("status:")) {
    const tail = lower.slice("status:".length);
    const mapped = STATUS_ALIAS[tail];
    if (mapped != null) {
      return { kind: "status", value: mapped };
    }
    // Double-colon / bogus tail → fall through to idPrefix unless the
    // tail is well-formed-but-unknown, in which case it's malformed.
    if (tail.startsWith(":")) {
      return { kind: "idPrefix", value: lower };
    }
    return { kind: "malformed", raw: atom };
  }

  // `workflow:<substring>` — empty tail is malformed (matches everything
  // would be confusing UX, plan §3.2.2).
  if (lower.startsWith("workflow:")) {
    const tail = atom.slice("workflow:".length); // preserve original case
    if (tail.length === 0) {
      return { kind: "malformed", raw: atom };
    }
    return { kind: "workflow", value: tail.toLowerCase() };
  }

  // `since:<duration>` — parse via tryParseDurationMs.
  if (lower.startsWith("since:")) {
    const tail = lower.slice("since:".length);
    const durationMs = tryParseDurationMs(tail);
    if (durationMs == null) {
      return { kind: "malformed", raw: atom };
    }
    return { kind: "since", durationMs };
  }

  // Free-text id-prefix fallback.
  return { kind: "idPrefix", value: lower };
}

/**
 * Parse the raw filter input into a `RunsFilterInput`. Empty input yields
 * an empty terms list (identity filter). Malformed atoms are retained in
 * the list so the UI can annotate them.
 */
export function parseFilterInput(raw: string): RunsFilterInput {
  const atoms = lex(raw);
  const terms: RunsFilterTerm[] = [];
  for (const atom of atoms) {
    if (atom.length === 0) continue;
    terms.push(classifyAtom(atom));
  }
  return { raw, terms };
}

// ---------------------------------------------------------------------------
// Predicate application
// ---------------------------------------------------------------------------

function matchesTerm(
  row: RunsTableRow,
  term: RunsFilterTerm,
  nowMs: number,
): boolean {
  switch (term.kind) {
    case "status":
      return row.info.status === term.value;
    case "workflow": {
      if (term.value.length === 0) return true;
      return row.info.workflowName.toLowerCase().includes(term.value);
    }
    case "since": {
      const startedMs = Date.parse(row.info.startedAt);
      if (!Number.isFinite(startedMs)) return false;
      return startedMs >= nowMs - term.durationMs;
    }
    case "idPrefix": {
      if (term.value.length === 0) return false;
      return row.info.id.toLowerCase().startsWith(term.value);
    }
    case "malformed":
      return true; // malformed terms never filter anything out
    default: {
      const _exhaustive: never = term;
      return _exhaustive;
    }
  }
}

/**
 * Apply the filter to a row list, returning a fresh `ReadonlyArray`.
 * Multiple (non-malformed) terms combine with logical AND. Malformed
 * terms are ignored by the predicate — they only affect the UI
 * annotation. An empty terms list (or a terms list of all malformed
 * terms) is the identity filter.
 *
 * `nowMs` is threaded through for `since:` predicates. Callers freeze it
 * in tests; production wiring passes the same `nowMs` that drives the
 * elapsed column (plan §7.4).
 */
export function applyFilter(
  rows: ReadonlyArray<RunsTableRow>,
  filter: RunsFilterInput,
  nowMs: number,
): ReadonlyArray<RunsTableRow> {
  const active = filter.terms.filter((t) => t.kind !== "malformed");
  if (active.length === 0) return rows.slice();
  const out: RunsTableRow[] = [];
  for (const row of rows) {
    let pass = true;
    for (const term of active) {
      if (!matchesTerm(row, term, nowMs)) {
        pass = false;
        break;
      }
    }
    if (pass) out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Archive predicate
// ---------------------------------------------------------------------------

/**
 * Is a row currently archived per the given policy? Running and suspended
 * runs are never archived (plan §4.2). For terminal runs, archived means
 * `(now - completedAt) > threshold`, strict greater-than — a completion
 * at exactly 24h is still visible.
 */
export function isArchived(
  info: RunInfo,
  policy: RunsArchivePolicy,
  nowMs: number,
): boolean {
  if (info.status === "running") return false;
  if (info.status === "suspended") return false;
  if (info.completedAt == null) return false;
  const completedMs = Date.parse(info.completedAt);
  if (!Number.isFinite(completedMs)) return false;
  const age = nowMs - completedMs;
  if (info.status === "complete") return age > policy.completeMaxAgeMs;
  if (info.status === "error") return age > policy.errorMaxAgeMs;
  return false;
}

/**
 * Partition rows into `{shown, archived}`. When `policy.shown === true`,
 * the `shown` list contains every row; `archived` is still populated so
 * the footer count reflects how many rows the toggle is currently
 * including. Sum invariant: `shown.length + archived.length === rows.length`
 * holds only when `policy.shown === false`.
 */
export function applyArchive(
  rows: ReadonlyArray<RunsTableRow>,
  policy: RunsArchivePolicy,
  nowMs: number,
): {
  readonly shown: ReadonlyArray<RunsTableRow>;
  readonly archived: ReadonlyArray<RunsTableRow>;
} {
  const shown: RunsTableRow[] = [];
  const archived: RunsTableRow[] = [];
  for (const row of rows) {
    const a = isArchived(row.info, policy, nowMs);
    if (policy.shown || !a) shown.push(row);
    if (a) archived.push(row);
  }
  return { shown, archived };
}
