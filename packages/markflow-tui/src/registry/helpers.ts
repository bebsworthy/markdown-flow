// src/registry/helpers.ts
//
// Pure helpers for the workflow registry (P4-T1).
//
// Authoritative references:
//   - docs/tui/features.md §3.1 (Persistence).
//   - docs/tui/plans/P4-T1.md §2.3 (helper contracts).
//
// PURITY NOTE: this module MUST NOT import from `ink`, `react`, `node:*`,
// `fs`, `path`, or any I/O / rendering surface. Registered in
// test/state/purity.test.ts as a pure module.

import type { RegistryEntry, RegistryState } from "./types.js";

/**
 * Returns true iff `e` is a plain object with valid `source` (string) and
 * `addedAt` (string parseable as a date). Extra fields are tolerated for
 * forward compatibility.
 */
export function validateEntry(e: unknown): e is RegistryEntry {
  if (e === null || typeof e !== "object") return false;
  if (Array.isArray(e)) return false;
  const obj = e as Record<string, unknown>;
  if (typeof obj.source !== "string") return false;
  if (typeof obj.addedAt !== "string") return false;
  const ts = Date.parse(obj.addedAt);
  if (!Number.isFinite(ts)) return false;
  return true;
}

/**
 * Parse raw file bytes into a validated `RegistryState`. Returns `null` if
 * the JSON is syntactically invalid OR if the structural shape fails
 * (must be an array of `{source: string, addedAt: string}` objects). The
 * caller (store.ts) treats `null` as "corrupt — back up + start empty".
 */
export function parseRegistryJson(raw: string): RegistryState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const entries: RegistryEntry[] = [];
  for (const item of parsed) {
    if (!validateEntry(item)) return null;
    // Normalise to a plain `{source, addedAt}` so downstream callers never
    // observe transit-only extra fields. Extras are tolerated at validate
    // time but dropped in the in-memory model.
    entries.push({ source: item.source, addedAt: item.addedAt });
  }
  return { entries };
}

/**
 * Serialise `state.entries` with stable 2-space indentation and a trailing
 * newline. Entry order is preserved (the caller handles sort semantics).
 */
export function serializeRegistry(state: RegistryState): string {
  // Materialise to a plain array so JSON.stringify emits a stable shape —
  // `ReadonlyArray` is structurally identical but we want to guarantee no
  // host-specific iteration quirks for deterministic output.
  const plain = state.entries.map((e) => ({
    source: e.source,
    addedAt: e.addedAt,
  }));
  return `${JSON.stringify(plain, null, 2)}\n`;
}

/**
 * Case- and whitespace-sensitive source equality. Sources are compared
 * verbatim — we do NOT normalise paths (features.md §3.1: "source is what
 * the user typed"). Two entries with the same resolved absolute path but
 * different spelling (`./foo` vs `foo`) are considered distinct.
 */
export function isSameSource(a: string, b: string): boolean {
  return a === b;
}

/**
 * Pure — returns a new `RegistryState` with the entry added. De-dupe
 * semantics: if an entry with `isSameSource(existing.source, entry.source)`
 * already exists, the existing entry is replaced with the new one (MRU:
 * preserves the new `addedAt`, moves the record to the end of the list).
 * Insertion order is the on-disk source of truth; UI sort is applied at
 * display time.
 */
export function addEntry(
  state: RegistryState,
  entry: RegistryEntry,
): RegistryState {
  const filtered = state.entries.filter(
    (e) => !isSameSource(e.source, entry.source),
  );
  return { entries: [...filtered, entry] };
}

/**
 * Pure — returns a new `RegistryState` with all entries satisfying
 * `predicate` removed. Hard delete; no tombstones (the file is the source
 * of truth).
 */
export function removeEntry(
  state: RegistryState,
  predicate: (e: RegistryEntry) => boolean,
): RegistryState {
  return { entries: state.entries.filter((e) => !predicate(e)) };
}

/**
 * Utility for UI display — does not mutate. Stable sort by `addedAt` desc
 * (most recently added first). Equal timestamps retain input order.
 */
export function sortByAddedAt(
  entries: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<RegistryEntry> {
  const indexed = entries.map((e, idx) => ({ e, idx }));
  indexed.sort((a, b) => {
    const ta = Date.parse(a.e.addedAt);
    const tb = Date.parse(b.e.addedAt);
    if (tb !== ta) return tb - ta;
    // Stable tiebreak: preserve input order.
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.e);
}
