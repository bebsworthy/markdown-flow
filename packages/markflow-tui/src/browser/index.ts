// src/browser/index.ts
//
// Public barrel for the browser module. React components are exported from
// `src/components/*` — this file only re-exports the pure + async
// resolver surface.

export { resolveEntry, resolveEntries } from "./resolver.js";
export { formatEntryId } from "./preview-layout.js";
export type {
  EntrySourceKind,
  EntryStatus,
  LastRunInfo,
  ResolvedEntry,
  ResolverOptions,
} from "./types.js";
