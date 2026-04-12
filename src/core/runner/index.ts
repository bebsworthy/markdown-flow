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
  workdirPath: string,
  env: Record<string, string>,
  runDir: string,
  config: MarkflowConfig,
  globalContext: Record<string, unknown>,
  onOutput?: StepOutputHandler,
): Promise<StepOutput> {
  if (step.type === "script") {
    return runScript(step, env, workdirPath, runDir, onOutput);
  }
  return runAgent(
    step,
    context,
    outgoingEdgeLabels,
    workdirPath,
    config,
    env,
    globalContext,
    onOutput,
  );
}
