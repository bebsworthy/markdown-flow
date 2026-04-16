import { watch as fsWatch, type FSWatcher } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createEventLogger,
  createEventLoggerFromExisting,
  type EventLogger,
} from "./event-logger.js";
import { extractTokenCounter, readEventLog, replay } from "./replay.js";
import { acquireRunLock } from "./run-lock.js";
import type {
  EngineSnapshot,
  RunInfo,
  RunStatus,
  WorkflowDefinition,
} from "./types.js";

export interface RunDirectory {
  id: string;
  path: string;
  workdirPath: string;
  events: EventLogger;
}

interface RunMeta {
  workflowName: string;
  sourceFile: string;
  startedAt: string;
  status: RunStatus;
  completedAt?: string;
}

/**
 * Handle returned by `openExistingRun`: enough to resume execution of a prior
 * run. `runDir` reopens the existing directory with a fresh EventLogger seeded
 * at `lastSeq`; `snapshot` is the pure fold of the persisted log; `tokenCounter`
 * is derived from existing `token:created` events so new tokens won't collide.
 */
export interface ResumeHandle {
  runDir: RunDirectory;
  snapshot: EngineSnapshot;
  lastSeq: number;
  tokenCounter: number;
  /**
   * Release the exclusive on-disk lock acquired by `openExistingRun`.
   * Idempotent: safe to call more than once, and safe to call after the
   * process-exit sweep has already removed the lock file. The engine's
   * `start()` `finally` block is the canonical caller on every terminal
   * path.
   */
  release: () => Promise<void>;
}

/**
 * Discriminated union of events emitted by `RunManager.watch()`.
 *
 * `added` and `updated` both carry a freshly-projected `RunInfo` snapshot
 * (via `getRun` → `readEventLog` → `replay`). `removed` carries only the
 * `runId` — the directory is gone by the time the event fires.
 */
export type RunEvent =
  | { kind: "added"; runId: string; snapshot: RunInfo }
  | { kind: "updated"; runId: string; snapshot: RunInfo }
  | { kind: "removed"; runId: string };

export interface WatchOptions {
  signal?: AbortSignal;
}

export interface RunManager {
  createRun(workflowDef: WorkflowDefinition): Promise<RunDirectory>;
  openExistingRun(id: string): Promise<ResumeHandle>;
  listRuns(): Promise<RunInfo[]>;
  getRun(id: string): Promise<RunInfo | null>;
  completeRun(id: string, status: RunStatus): Promise<void>;
  /**
   * Stream `RunEvent`s for every run under `runsDir`.
   *
   * - On first call, emits one `added` event per existing run in **ascending
   *   alphabetical order by runId** (runIds are ISO-8601 timestamps, so this
   *   is effectively chronological ascending).
   * - Thereafter emits `added` as new run directories appear, `updated` as
   *   `meta.json` writes land (debounced 50 ms per run), and `removed` when
   *   run directories are deleted.
   * - The iterator returns cleanly on `AbortSignal.abort()`, `break` in a
   *   `for await`, or the consumer calling `return()` on the iterator.
   *
   * Each call returns an independent generator with its own watcher set.
   */
  watch(options?: WatchOptions): AsyncIterable<RunEvent>;
}

const WATCH_DEBOUNCE_MS = 50;

export function createRunManager(runsDir = "./runs"): RunManager {
  // Hoisted so both `listRuns` and `watch` share the same projection path.
  const getRunLocal = async (id: string): Promise<RunInfo | null> => {
    const runPath = join(runsDir, id);
    try {
      const metaRaw = await readFile(join(runPath, "meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw) as RunMeta;
      const events = await readEventLog(runPath);
      const snapshot = replay(events);
      const steps = snapshot.completedResults;

      return {
        id,
        workflowName: meta.workflowName,
        sourceFile: meta.sourceFile,
        status: meta.status,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        steps,
      };
    } catch {
      return null;
    }
  };

  return {
    async createRun(workflowDef: WorkflowDefinition): Promise<RunDirectory> {
      const id = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\./g, "-");
      const runPath = join(runsDir, id);
      const workdirPath = join(runPath, "workdir");

      await mkdir(workdirPath, { recursive: true });

      const meta: RunMeta = {
        workflowName: workflowDef.name,
        sourceFile: workflowDef.sourceFile,
        startedAt: new Date().toISOString(),
        status: "running",
      };
      await writeFile(
        join(runPath, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf-8",
      );

      await writeFile(join(runPath, "events.jsonl"), "", "utf-8");

      const events = createEventLogger(runPath);
      return { id, path: runPath, workdirPath, events };
    },

    async openExistingRun(id: string): Promise<ResumeHandle> {
      const runPath = join(runsDir, id);
      // `readEventLog` throws if events.jsonl is missing or truncated beyond
      // the tolerated single-trailing-line case; the `access` check above it
      // gives a clearer error for a missing run directory.
      await access(join(runPath, "events.jsonl"));

      // Acquire the exclusive lock *before* reading events so two concurrent
      // resumers can't both fold the log and append divergent state. Any
      // throw in the projection path below must release the lock.
      const release = await acquireRunLock(runPath);

      try {
        const events = await readEventLog(runPath);
        const snapshot = replay(events);
        const lastSeq = events.length === 0 ? 0 : events[events.length - 1].seq;
        const tokenCounter = extractTokenCounter(events);

        const workdirPath = join(runPath, "workdir");
        // Reopen workdir without recreating (safe even if the directory already
        // exists — `mkdir -p` equivalent).
        await mkdir(workdirPath, { recursive: true });

        const runDir: RunDirectory = {
          id,
          path: runPath,
          workdirPath,
          events: createEventLoggerFromExisting(runPath, lastSeq),
        };

        // Flip meta.status back to "running" so `getRun`/`listRuns` reflect the
        // resumed state. On completion the engine will call `completeRun` with
        // the new terminal status.
        try {
          const metaRaw = await readFile(join(runPath, "meta.json"), "utf-8");
          const meta = JSON.parse(metaRaw) as RunMeta;
          if (meta.status !== "running") {
            meta.status = "running";
            delete meta.completedAt;
            await writeFile(
              join(runPath, "meta.json"),
              JSON.stringify(meta, null, 2),
              "utf-8",
            );
          }
        } catch {
          // meta.json is a write-through cache; absence shouldn't block resume.
        }

        return { runDir, snapshot, lastSeq, tokenCounter, release };
      } catch (err) {
        await release();
        throw err;
      }
    },

    async listRuns(): Promise<RunInfo[]> {
      try {
        const entries = await readdir(runsDir);
        const runs: RunInfo[] = [];
        for (const entry of entries.sort().reverse()) {
          const run = await getRunLocal(entry);
          if (run) runs.push(run);
        }
        return runs;
      } catch {
        return [];
      }
    },

    async getRun(id: string): Promise<RunInfo | null> {
      return getRunLocal(id);
    },

    async completeRun(id: string, status: RunStatus): Promise<void> {
      const runPath = join(runsDir, id);
      const metaRaw = await readFile(join(runPath, "meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw) as RunMeta;
      meta.status = status;
      // Suspended runs are non-terminal — do not stamp a completion time.
      if (status === "suspended") {
        delete meta.completedAt;
      } else {
        meta.completedAt = new Date().toISOString();
      }
      await writeFile(
        join(runPath, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf-8",
      );
    },

    watch(options?: WatchOptions): AsyncIterable<RunEvent> {
      return watchImpl(runsDir, getRunLocal, options);
    },
  };
}

/**
 * Implementation of `RunManager.watch`. Factored into a module-level async
 * generator so the factory object literal stays tidy — it still closes over
 * `runsDir` and the hoisted `getRunLocal` via its parameters.
 */
async function* watchImpl(
  runsDir: string,
  getRunLocal: (id: string) => Promise<RunInfo | null>,
  options?: WatchOptions,
): AsyncIterable<RunEvent> {
  const signal = options?.signal;
  if (signal?.aborted) return;

  const queue: RunEvent[] = [];
  let waiter: { resolve: () => void } | null = null;
  let done = false;

  const runWatchers = new Map<string, FSWatcher>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const seen = new Set<string>();
  const emittedAddedFor = new Set<string>();

  const push = (event: RunEvent): void => {
    if (done) return;
    queue.push(event);
    const w = waiter;
    waiter = null;
    w?.resolve();
  };

  const scheduleUpdate = (runId: string): void => {
    if (done) return;
    const existing = debounceTimers.get(runId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      debounceTimers.delete(runId);
      if (done) return;
      getRunLocal(runId)
        .then((snapshot) => {
          if (done) return;
          if (!snapshot) return;
          if (!emittedAddedFor.has(runId)) {
            emittedAddedFor.add(runId);
            push({ kind: "added", runId, snapshot });
          } else {
            push({ kind: "updated", runId, snapshot });
          }
        })
        .catch(() => {
          /* swallow: projection errors are treated as "not ready yet" */
        });
    }, WATCH_DEBOUNCE_MS);
    debounceTimers.set(runId, t);
  };

  const attachMetaWatcher = (runId: string): void => {
    if (runWatchers.has(runId)) return;
    const metaPath = join(runsDir, runId, "meta.json");
    try {
      const watcher = fsWatch(metaPath, { persistent: false }, () => {
        scheduleUpdate(runId);
      });
      watcher.on("error", () => {
        /* meta.json may disappear mid-watch; top-level watcher will catch removal. */
      });
      runWatchers.set(runId, watcher);
    } catch {
      /* meta.json not yet written; top-level watcher will refire when it lands. */
    }
  };

  const handleAdded = async (runId: string): Promise<void> => {
    if (seen.has(runId)) return;
    seen.add(runId);
    // Attach the meta watcher FIRST so writes landing after projection still
    // wake us up.
    attachMetaWatcher(runId);
    const snapshot = await getRunLocal(runId);
    if (done) return;
    if (snapshot) {
      emittedAddedFor.add(runId);
      push({ kind: "added", runId, snapshot });
    }
    // If snapshot is null, we keep seen=true; scheduleUpdate (triggered by
    // the meta.json watcher) will upgrade the first successful projection to
    // `added` via the emittedAddedFor guard.
  };

  const handleRemoved = (runId: string): void => {
    seen.delete(runId);
    const wasEmitted = emittedAddedFor.delete(runId);
    const w = runWatchers.get(runId);
    if (w) {
      w.close();
      runWatchers.delete(runId);
    }
    const t = debounceTimers.get(runId);
    if (t) {
      clearTimeout(t);
      debounceTimers.delete(runId);
    }
    if (wasEmitted) {
      push({ kind: "removed", runId });
    }
  };

  const onTopLevelChange = async (
    _eventType: string,
    filename: string | null,
  ): Promise<void> => {
    if (done) return;
    if (!filename) return; // platforms may coalesce; best-effort
    const runId = filename;
    const runPath = join(runsDir, runId);
    try {
      await access(runPath);
      if (!seen.has(runId)) await handleAdded(runId);
    } catch {
      if (seen.has(runId)) handleRemoved(runId);
    }
  };

  // Ensure the runs directory exists before attaching the watcher.
  await mkdir(runsDir, { recursive: true });

  const topWatcher = fsWatch(runsDir, { persistent: false }, (eventType, fn) => {
    onTopLevelChange(eventType, fn).catch(() => {
      /* swallow: best-effort */
    });
  });
  topWatcher.on("error", () => {
    /* swallow transient errors */
  });

  const teardown = (): void => {
    topWatcher.close();
    for (const w of runWatchers.values()) w.close();
    runWatchers.clear();
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
  };

  const onAbort = (): void => {
    done = true;
    const w = waiter;
    waiter = null;
    w?.resolve();
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    // Enumerate existing runs AFTER attaching the watcher so we don't miss
    // any dir created during enumeration (seen-dedupe covers the overlap).
    let existing: string[] = [];
    try {
      existing = await readdir(runsDir);
    } catch {
      existing = [];
    }
    existing.sort();
    for (const runId of existing) {
      if (done) break;
      await handleAdded(runId);
    }

    while (!done) {
      while (queue.length > 0) {
        const ev = queue.shift() as RunEvent;
        yield ev;
        if (done) break;
      }
      if (done) break;
      if (signal?.aborted) {
        done = true;
        break;
      }
      await new Promise<void>((resolve) => {
        waiter = { resolve };
      });
    }
  } finally {
    done = true;
    if (signal) signal.removeEventListener("abort", onAbort);
    teardown();
  }
}
