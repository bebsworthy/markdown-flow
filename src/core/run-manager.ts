import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEventLogger, type EventLogger } from "./event-logger.js";
import { readEventLog, replay } from "./replay.js";
import type { RunInfo, RunStatus, WorkflowDefinition } from "./types.js";

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

export interface RunManager {
  createRun(workflowDef: WorkflowDefinition): Promise<RunDirectory>;
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
      meta.completedAt = new Date().toISOString();
      await writeFile(
        join(runPath, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf-8",
      );
    },
  };
}
