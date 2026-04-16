import type {
  StepDefinition,
  StepResult,
  StepOutput,
  MarkflowConfig,
  StepOutputHandler,
} from "../types.js";
import { runScript } from "./script.js";
import { runAgent } from "./agent.js";

/**
 * Sidecar transcript paths for a single step execution. When provided, the
 * runner tees child stdout/stderr into these files (append mode) alongside
 * the existing in-memory buffers.
 */
export interface SidecarPaths {
  stdoutPath: string;
  stderrPath: string;
}

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
  signal?: AbortSignal,
  sidecar?: SidecarPaths,
): Promise<StepOutput> {
  if (step.type === "script") {
    return runScript(step, env, workdirPath, runDir, onOutput, signal, sidecar);
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
    signal,
    sidecar,
  );
}
