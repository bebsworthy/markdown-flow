// src/browser/types.ts
//
// Public types for the workflow browser module (P4-T2). Every type is
// declared structurally — no runtime exports — so this file is scanned as
// pure by `test/state/purity.test.ts`.
//
// Authoritative references:
//   - docs/tui/features.md §3.1
//   - docs/tui/plans/P4-T2.md §2.1
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Only type-only imports are
// allowed (`import type { ... } from "markflow"` is OK because purity tests
// scan runtime imports via regex — type-only imports pass through).

import type {
  ValidationDiagnostic,
  WorkflowDefinition,
} from "markflow";
import type { RegistryEntry } from "../registry/types.js";

/** Where the entry actually lives, once resolved. */
export type EntrySourceKind = "file" | "workspace";

/**
 * Status of a resolved registry entry.
 *   - "pending"      — async resolution in flight (initial render).
 *   - "valid"        — parsed cleanly + no `error`-severity diagnostics.
 *   - "parse-error"  — file exists but parse or validate failed hard.
 *   - "missing"      — file/dir not found (renders "✗ 404").
 */
export type EntryStatus = "pending" | "valid" | "parse-error" | "missing";

/**
 * Minimal last-run projection sourced from `RunManager.listRuns()`.
 * Only shapes we actually render in the list row.
 */
export interface LastRunInfo {
  /** "complete" | "error" | "running" | "suspended" — mirrors engine `RunStatus`. */
  readonly status: "complete" | "error" | "running" | "suspended";
  /** ISO-8601 UTC. Used to compute the "2h / 1d" badge. */
  readonly endedAt: string | null;
}

/**
 * An entry resolved for display. Carries enough info for both the list
 * row (status + badge + last-run) and the preview pane (parsed workflow
 * + diagnostics). Never mutated — resolver returns a fresh instance.
 */
export interface ResolvedEntry {
  /** The original registry record (pointer-equal to registryState.entries[i]). */
  readonly entry: RegistryEntry;
  /** Stable client-side id used for `SELECT_WORKFLOW` dispatch. See §2.3. */
  readonly id: string;
  /** Where the entry lives; `"file"` even for missing .md entries. */
  readonly sourceKind: EntrySourceKind;
  /** Resolved absolute path on disk (if resolvable); null for missing. */
  readonly absolutePath: string | null;
  /** Resolution status. See `EntryStatus` above. */
  readonly status: EntryStatus;
  /** Human-readable title — `workflow.name` when parsed, fallback to basename. */
  readonly title: string;
  /** Full parsed workflow when `status === "valid"`. null otherwise. */
  readonly workflow: WorkflowDefinition | null;
  /**
   * Diagnostics from `validateWorkflow` plus parser diagnostics. Empty
   * array when `status === "valid"` with zero diagnostics. Non-empty +
   * `status === "parse-error"` when parsing failed (synthetic diagnostic).
   */
  readonly diagnostics: ReadonlyArray<ValidationDiagnostic>;
  /** Last run info if any; null otherwise. */
  readonly lastRun: LastRunInfo | null;
  /** Opaque reason string when `status === "missing"` or `"parse-error"`. */
  readonly errorReason: string | null;
}

/** Options passed to `resolveEntry` / `resolveEntries`. */
export interface ResolverOptions {
  /** Base dir used to resolve relative `entry.source` values (typically cwd). */
  readonly baseDir: string;
  /** When true, query `RunManager.listRuns()` for last-run info. Defaults to true. */
  readonly readLastRun?: boolean;
  /** Override clock for deterministic "N hours ago" tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}
