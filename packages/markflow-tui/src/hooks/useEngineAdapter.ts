// src/hooks/useEngineAdapter.ts
//
// React shim for the engine adapter. The ONLY file in this task that
// imports from `react`. Owns the `AbortController` lifecycle so the
// adapter's `finally` block runs on unmount or when `runId` changes.
//
// Authoritative references: docs/tui/plans/P3-T2.md §6.

import { useEffect, useReducer } from "react";
import { createEngineAdapter } from "../engine/adapter.js";
import {
  engineReducer,
  initialEngineState,
  toEngineAction,
} from "../engine/reducer.js";
import type { EngineState } from "../engine/types.js";

export interface UseEngineAdapterOptions {
  readonly runsDir: string;
  readonly runId?: string;
  readonly fromSeq?: number;
}

/**
 * Subscribes to `createEngineAdapter` for the duration of the component's
 * mount. Returns the live `EngineState` projection.
 *
 * Lifecycle guarantees:
 * - Mount → spawn an `AbortController` + async loop.
 * - `runId` change → React cleanup → `controller.abort()` → adapter
 *   `finally` tears down both pumps → `for await` exits → new effect
 *   runs with the new `runId`.
 * - Unmount → same cleanup path; no lingering `fs.watch` handles.
 * - React strict-mode double-invoke → cleanup between invocations
 *   prevents watcher leaks.
 */
export function useEngineAdapter(
  opts: UseEngineAdapterOptions,
): EngineState {
  const [state, dispatch] = useReducer(engineReducer, initialEngineState);

  useEffect(() => {
    const controller = new AbortController();
    const adapter = createEngineAdapter({
      runsDir: opts.runsDir,
      runId: opts.runId,
      fromSeq: opts.fromSeq,
      signal: controller.signal,
    });

    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        for await (const event of adapter) {
          if (cancelled) break;
          dispatch(toEngineAction(event));
        }
      } catch {
        // Adapter errors are non-fatal; teardown handled below.
      }
    })();

    return (): void => {
      cancelled = true;
      controller.abort();
    };
  }, [opts.runsDir, opts.runId, opts.fromSeq]);

  return state;
}
