import type { StepDefinition, StepResult, StepOutput, MarkflowConfig } from "../types.js";
import { runScript } from "./script.js";
import { runAgent } from "./agent.js";

export async function runStep(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workspacePath: string,
  env: Record<string, string>,
  runDir: string,
  config: MarkflowConfig,
): Promise<StepOutput> {
  if (step.type === "script") {
    return runScript(step, env, workspacePath, runDir);
  }
  return runAgent(step, context, outgoingEdgeLabels, workspacePath, config);
}
