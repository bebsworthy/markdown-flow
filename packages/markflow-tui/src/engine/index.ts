// src/engine/index.ts
//
// Barrel re-exports for the engine slice. Pure surface only — no React,
// no Ink, no `node:*` leaks to consumers (the adapter re-exports its
// factory, which internally uses `node:path` but does not expose it).

export { createEngineAdapter } from "./adapter.js";
export {
  engineReducer,
  initialEngineState,
  toEngineAction,
  TAIL_EVENTS_CAP,
} from "./reducer.js";
export type {
  EngineAction,
  EngineAdapterEvent,
  EngineAdapterOptions,
  EngineState,
  LiveRunSnapshot,
  MarkflowRunEvent,
} from "./types.js";
