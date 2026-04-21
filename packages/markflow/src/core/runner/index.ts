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

export interface RunStepOptions {
  step: StepDefinition;
  context: StepResult[];
  outgoingEdgeLabels: string[];
  workdirPath: string;
  env: Record<string, string>;
  runDir: string;
  config: MarkflowConfig;
  globalContext: Record<string, unknown>;
  onOutput?: StepOutputHandler;
  signal?: AbortSignal;
  sidecar?: SidecarPaths;
  localContext?: unknown;
  itemContext?: unknown;
}

export async function runStep(opts: RunStepOptions): Promise<StepOutput> {
  if (opts.step.type === "script") {
    return runScript(
      opts.step, opts.env, opts.workdirPath, opts.runDir,
      opts.onOutput, opts.signal, opts.sidecar,
    );
  }
  return runAgent(
    opts.step,
    opts.context,
    opts.outgoingEdgeLabels,
    opts.workdirPath,
    opts.config,
    opts.env,
    opts.globalContext,
    opts.onOutput,
    opts.signal,
    opts.sidecar,
    opts.localContext,
    opts.itemContext,
  );
}
