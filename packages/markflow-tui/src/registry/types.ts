// src/registry/types.ts
//
// Public types for the workflow registry persistence layer (P4-T1).
//
// Authoritative references:
//   - docs/tui/features.md §3.1 (Persistence paragraph) — file format.
//   - docs/tui/plans/P4-T1.md §2.1 (type definitions).
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Registered in
// test/state/purity.test.ts as a pure module. Only declares types.

/**
 * A single registry entry.
 *
 * Shape is authoritative per features.md §3.1 (Persistence).
 *   - source:  the string the user added (verbatim — path, URL, workspace
 *              dir). Resolution (absolute path, URL materialisation, parse
 *              check) happens at display time in P4-T2, NOT here.
 *   - addedAt: ISO-8601 timestamp in UTC. Format matches the spec example
 *              ("2026-04-15T10:22:00Z"); we serialise with `.toISOString()`
 *              at write time and parse with `Date.parse()` at read time.
 */
export interface RegistryEntry {
  readonly source: string;
  readonly addedAt: string; // ISO-8601 UTC, e.g. "2026-04-15T10:22:00Z"
}

/**
 * Current registry slice. Separate from `AppState`; P4-T2 may decide to
 * project this into the main reducer or keep it behind a context.
 */
export interface RegistryState {
  readonly entries: ReadonlyArray<RegistryEntry>;
}

/** Result of `loadRegistry`. */
export interface LoadResult {
  readonly state: RegistryState;
  /** True when the file was present but malformed (and a `.bak` was made). */
  readonly corruptionDetected: boolean;
  /** Absolute path of the backup written, iff `corruptionDetected`. */
  readonly backupPath: string | null;
}

/** Typed errors surfaced by the registry API. Structural, no Error subclass. */
export type RegistryError =
  | { readonly kind: "io"; readonly cause: unknown; readonly path: string }
  | {
      readonly kind: "invalid-path";
      readonly path: string;
      readonly reason: string;
    };

/**
 * CLI-flag-derived config, consumed by the (future) React layer.
 * The parser in `cli.tsx` returns a narrow `{ listPath; persist }` shape
 * (see `parseRegistryFlags`); call sites turn that into an absolute path
 * at wire time via `resolveRegistryPath`.
 */
export interface RegistryConfig {
  /** Resolved absolute path; `null` means "in-memory only" (`--no-save`). */
  readonly path: string | null;
  /** Mirror of `path !== null` for call-site readability. */
  readonly persist: boolean;
}
