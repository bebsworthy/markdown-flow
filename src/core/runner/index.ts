import type {
  StepDefinition,
  StepResult,
  StepOutput,
  MarkflowConfig,
  StepOutputHandler,
} from "../types.js";
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
  resolvedInputs: Record<string, string> = {},
  onOutput?: StepOutputHandler,
): Promise<StepOutput> {
  if (step.type === "script") {
    return runScript(step, env, workspacePath, runDir, onOutput);
  }
  return runAgent(
    step,
    context,
    outgoingEdgeLabels,
    workspacePath,
    config,
    resolvedInputs,
    onOutput,
  );
}
