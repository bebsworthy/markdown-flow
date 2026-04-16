// src/add-modal/types.ts
//
// Public types for the add-workflow modal module (P4-T3).
//
// Authoritative references:
//   - docs/tui/features.md §3.1 (Launch / Adding / Persistence).
//   - docs/tui/mockups.md §2 (Add modal fuzzy-find tab + empty-state).
//   - docs/tui/plans/P4-T3.md §5.1.
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Type-only imports from the
// engine package are fine (`import type { ... } from "markflow"`), per the
// same convention used by browser/types.ts. Registered in
// test/state/purity.test.ts as a pure module.

import type { ValidationDiagnostic } from "markflow";

/**
 * The two input modes the add modal exposes. Controlled by the overlay
 * state so that future command-palette commands can open the modal pre-
 * pinned to a tab (e.g. `addWorkflow url`).
 */
export type AddModalTab = "fuzzy" | "url";

/**
 * Narrow classification for candidates surfaced by `walkCandidates`.
 * `truncated` is reserved for the sentinel — individual candidates are
 * always "file" or "workspace".
 */
export type CandidateKind = "file" | "workspace" | "truncated";

/**
 * One row the walker has discovered. Classification (parseable? workspace
 * config valid?) happens lazily via `validateCandidate` for visible rows
 * only.
 */
export interface Candidate {
  /** Whether this row is a single .md file or a directory workspace. */
  readonly kind: "file" | "workspace";
  /** Absolute path on disk. */
  readonly absolutePath: string;
  /** Display path: if inside the walker root, a root-relative form; else absolute. */
  readonly displayPath: string;
  /** Depth from root (may inform future width-tier heuristics). */
  readonly depth: number;
}

/**
 * Sentinel yielded by the walker when `maxCandidates` has been reached.
 * The consumer uses this to render the "showing N/N+ — refine" footer.
 */
export interface TruncatedSentinel {
  readonly kind: "truncated";
  readonly scannedCount: number;
}

/**
 * A candidate annotated with a fuzzy-score. Ordering is score desc then
 * displayPath asc (stable tie-break).
 */
export interface RankedCandidate {
  readonly candidate: Candidate;
  readonly score: number;
  /** Index positions in `candidate.displayPath` where each query char matched. */
  readonly matchPositions: ReadonlyArray<number>;
}

/**
 * Options accepted by `walkCandidates`. All fields optional; sensible
 * defaults are applied at call time.
 */
export interface WalkerOptions {
  /** Cap on total candidates yielded. Default 500. */
  readonly maxCandidates?: number;
  /** Cap on directory depth (root is depth 0). Default unbounded. */
  readonly maxDepth?: number;
  /** Directory names to skip verbatim. Default: [".git", "node_modules", ".markflow-tui"]. */
  readonly skipDirs?: ReadonlyArray<string>;
  /** AbortSignal that stops the walk. */
  readonly signal?: AbortSignal;
}

/**
 * Result of `validateCandidate`. Never throws — every failure is mapped
 * onto one of these variants so callers render a deterministic badge.
 */
export type ValidationResult =
  | { readonly kind: "file-valid" }
  | {
      readonly kind: "file-parse-error";
      readonly message: string;
      readonly diagnostics?: ReadonlyArray<ValidationDiagnostic>;
    }
  | { readonly kind: "workspace" }
  | { readonly kind: "workspace-invalid"; readonly message: string };

/**
 * Result of `ingestUrl`. Success carries the absolute workspace dir (the
 * value the caller should pass to `addEntry`) plus the full workflow file
 * path. Failure carries a short reason message suitable for inline display.
 */
export type UrlIngestResult =
  | {
      readonly ok: true;
      readonly workspaceDir: string;
      readonly workflowPath: string;
    }
  | { readonly ok: false; readonly reason: string };
