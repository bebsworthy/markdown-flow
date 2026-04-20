// src/engine/adapter.ts
//
// `createEngineAdapter` — merges `runManager.watch` (list updates) and
// `tailEventLog` (per-run events) into a single async iterable feeding the
// engine reducer via `toEngineAction`.
//
// Authoritative references:
//   - docs/tui/plan.md §P3-T2 (lines 277-286)
//   - docs/tui/plans/P3-T2.md §3-§4 (design + implementation sketch)
//
// PURITY NOTE: this file is part of the pure engine slice. The only allowed
// side-effect import is `node:path::join` (deterministic, no I/O). No
// `ink`, no `react`, no other `node:*` modules. See
// `test/state/purity.test.ts` for enforcement.

import { join } from "node:path";
import {
  createRunManager,
  tailEventLog,
  type RunManager,
} from "markflow-cli";
import type {
  EngineAdapterEvent,
  EngineAdapterOptions,
} from "./types.js";

export function createEngineAdapter(
  options: EngineAdapterOptions,
): AsyncIterable<EngineAdapterEvent> {
  return { [Symbol.asyncIterator]: () => run(options) };
}

async function* run(
  options: EngineAdapterOptions,
): AsyncIterator<EngineAdapterEvent> {
  const rm: RunManager =
    options.runManager ?? createRunManager(requireRunsDir(options));

  const queue: EngineAdapterEvent[] = [];
  let waiter: { resolve: () => void } | null = null;
  let done = false;

  const wake = (): void => {
    const w = waiter;
    waiter = null;
    w?.resolve();
  };

  const push = (event: EngineAdapterEvent): void => {
    if (done) return;
    queue.push(event);
    wake();
  };

  const listController = new AbortController();
  const tailController: AbortController | null = options.runId
    ? new AbortController()
    : null;

  // Link the caller's signal to both inner controllers. Also wake the main
  // loop so it notices the abort without waiting for a pump to push.
  const onExternalAbort = (): void => {
    listController.abort();
    tailController?.abort();
    wake();
  };
  if (options.signal.aborted) {
    onExternalAbort();
  } else {
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  // ---- List pump ---------------------------------------------------------
  const listPump: Promise<void> = (async (): Promise<void> => {
    try {
      for await (const ev of rm.watch({ signal: listController.signal })) {
        push({ kind: "list", event: ev });
      }
    } catch {
      // `fs.watch` errors surface here (transient unmount, etc.); swallow
      // to match the engine's own convention. The consumer still gets any
      // events queued before the error.
    }
  })();

  // ---- Per-run tail pump (optional) -------------------------------------
  let tailPump: Promise<void> = Promise.resolve();
  if (options.runId && tailController) {
    const runId: string = options.runId;
    const runDir = join(requireRunsDir(options), runId);
    const fromSeq = options.fromSeq ?? 0;
    const signal = tailController.signal;
    tailPump = (async (): Promise<void> => {
      try {
        for await (const ev of tailEventLog(runDir, fromSeq, { signal })) {
          push({ kind: "run", runId, event: ev });
        }
        push({
          kind: "run:detached",
          runId,
          reason: signal.aborted ? "aborted" : "terminal",
        });
      } catch {
        push({ kind: "run:detached", runId, reason: "aborted" });
      }
    })();
  }

  // ---- Main drain loop ---------------------------------------------------
  try {
    while (!done) {
      // Defensive copy via `Array.from`: if a pump pushes while we're mid-
      // yield, the shift()/length pair stays self-consistent because the
      // queue is a FIFO and we only shift from the front.
      while (queue.length > 0) {
        const ev = queue.shift();
        if (!ev) break;
        yield ev;
        if (done) break;
      }
      if (done) break;
      if (options.signal.aborted) {
        done = true;
        break;
      }
      await new Promise<void>((resolve) => {
        waiter = { resolve };
      });
    }
  } finally {
    done = true;
    // Remove the external-abort hook so the caller's signal is not retained.
    options.signal.removeEventListener?.("abort", onExternalAbort);
    listController.abort();
    tailController?.abort();
    // Await both pumps so their `finally` blocks run (closes fs.watch
    // handles, releases abort listeners) before we return. `allSettled`
    // guarantees one pump's rejection does not skip the other's cleanup.
    await Promise.allSettled(Array.from([listPump, tailPump]));
  }
}

function requireRunsDir(o: EngineAdapterOptions): string {
  if (o.runsDir) return o.runsDir;
  throw new Error(
    "createEngineAdapter: runsDir is required when runManager is not provided",
  );
}
