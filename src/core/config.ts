import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MarkflowConfig } from "./types.js";

export const DEFAULT_CONFIG: MarkflowConfig = {
  agent: "claude",
  agentFlags: [],
  parallel: true,
};

export async function loadConfig(
  workflowFilePath: string,
): Promise<MarkflowConfig> {
  const dir = dirname(workflowFilePath);
  const configPath = join(dir, ".workflow.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      agent: parsed.agent ?? DEFAULT_CONFIG.agent,
      agentFlags: parsed.agent_flags ?? DEFAULT_CONFIG.agentFlags,
      maxRetriesDefault: parsed.max_retries_default,
      parallel: parsed.parallel ?? DEFAULT_CONFIG.parallel,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
