// src/components/index.ts
//
// Public barrel for the components surface. Re-exports the Keybar
// component + its public types. Does NOT re-export layout internals —
// those live in keybar-layout.ts and are scanned for purity via
// test/state/purity.test.ts.

export { Keybar, type KeybarProps } from "./keybar.js";
export type { Binding, AppContext, KeySpec, Category } from "./types.js";
