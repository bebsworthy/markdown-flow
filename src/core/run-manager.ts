import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createEventLogger,
  createEventLoggerFromExisting,
  type EventLogger,
} from "./event-logger.js";
import { extractTokenCounter, readEventLog, replay } from "./replay.js";
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
}

export interface RunManager {
  createRun(workflowDef: WorkflowDefinition): Promise<RunDirectory>;
  openExistingRun(id: string): Promise<ResumeHandle>;
  listRuns(): Promise<RunInfo[]>;
  getRun(id: string): Promise<RunInfo | null>;
  completeRun(id: string, status: RunStatus): Promise<void>;
}

export function createRunManager(runsDir = "./runs"): RunManager {
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

      return { runDir, snapshot, lastSeq, tokenCounter };
    },

    async listRuns(): Promise<RunInfo[]> {
      try {
        const entries = await readdir(runsDir);
        const runs: RunInfo[] = [];
        for (const entry of entries.sort().reverse()) {
          const run = await this.getRun(entry);
          if (run) runs.push(run);
        }
        return runs;
      } catch {
        return [];
      }
    },

    async getRun(id: string): Promise<RunInfo | null> {
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
  };
}
