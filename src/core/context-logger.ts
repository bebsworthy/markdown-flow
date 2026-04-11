import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StepResult } from "./types.js";

export interface ContextLogger {
  append(result: StepResult): Promise<void>;
  readAll(): Promise<StepResult[]>;
  readonly path: string;
}

export function createContextLogger(runDir: string): ContextLogger {
  const filePath = join(runDir, "context.jsonl");

  return {
    path: filePath,

    async append(result: StepResult): Promise<void> {
      await appendFile(filePath, JSON.stringify(result) + "\n", "utf-8");
    },

    async readAll(): Promise<StepResult[]> {
      try {
        const content = await readFile(filePath, "utf-8");
        return content
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as StepResult);
      } catch {
        return [];
      }
    },
  };
}
