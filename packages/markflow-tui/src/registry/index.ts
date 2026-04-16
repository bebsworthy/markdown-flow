// src/registry/index.ts
//
// Public barrel for the registry module. `atomic-write` is internal and
// deliberately NOT re-exported.

export { loadRegistry, saveRegistry, resolveRegistryPath } from "./store.js";
export { addEntry, removeEntry, sortByAddedAt } from "./helpers.js";
export type {
  RegistryEntry,
  RegistryState,
  LoadResult,
  RegistryError,
  RegistryConfig,
} from "./types.js";
