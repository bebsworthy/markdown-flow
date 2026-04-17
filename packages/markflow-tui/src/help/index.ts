// src/help/index.ts — barrel for the help overlay module (P7-T3).

export * from "./types.js";
export { deriveHelpModel } from "./derive.js";
export type { DeriveHelpArgs } from "./derive.js";
export {
  helpReducer,
  initialHelpState,
} from "./reducer.js";
export type { HelpAction, HelpLocalState } from "./reducer.js";
