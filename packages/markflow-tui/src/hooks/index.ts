// src/hooks/index.ts
//
// Barrel — re-exports the hook surface.

export { useEngineAdapter } from "./useEngineAdapter.js";
export type { UseEngineAdapterOptions } from "./useEngineAdapter.js";
export { useSidecarStream } from "./useSidecarStream.js";
export type {
  SidecarState,
  StreamFactory,
  UseSidecarStreamOptions,
  UseSidecarStreamResult,
} from "./useSidecarStream.js";
