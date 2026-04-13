import { spawn } from "node:child_process";
import type {
  StepDefinition,
  StepOutput,
  StepResult,
  MarkflowConfig,
  StepOutputHandler,
} from "../types.js";
import { renderTemplate, type TemplateContext } from "../template.js";
import { createStreamParser } from "./stream-parser.js";

export function assembleAgentPrompt(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  _workdirPath: string,
  env: Record<string, string> = {},
  globalContext: Record<string, unknown> = {},
): string {
  const stepsMap: Record<string, { edge: string; summary: string; local?: unknown }> = {};
  for (const r of context) {
    stepsMap[r.node] = {
      edge: r.edge,
      summary: r.summary,
      ...(r.local ? { local: r.local } : {}),
    };
  }

  const templateCtx: TemplateContext = {
    vars: env,
    namespaces: { GLOBAL: globalContext, STEPS: stepsMap },
  };
  const body = renderTemplate(step.content, templateCtx, step.id);

  // Trailing protocol instructions. The edge hint only appears when the step
  // has multiple labelled outgoing edges — for single-edge steps the engine
  // auto-routes and "done" is unambiguous.
  const edgeHint =
    outgoingEdgeLabels.length >= 2
      ? `\n\nChoose edge from: ${outgoingEdgeLabels.join(", ")}`
      : "";

  return `${body}

---

The last line of your response MUST be exactly:
RESULT: {"edge": "<label>", "summary": "<one sentence>"}

You MAY emit zero or more LOCAL/GLOBAL lines anywhere before that:
LOCAL:  {...}   merges into this step's own local state (visible as {{ STEPS.<id>.local.* }} to later steps)
GLOBAL: {...}   merges into the workflow-wide global (visible as {{ GLOBAL.* }} to later steps)

Multiple LOCAL or GLOBAL lines shallow-merge (later keys win). Do NOT put "local" or "global" keys inside RESULT.${edgeHint}`;
}

export async function runAgent(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workdirPath: string,
  config: MarkflowConfig,
  env: Record<string, string> = {},
  globalContext: Record<string, unknown> = {},
  onOutput?: StepOutputHandler,
  signal?: AbortSignal,
): Promise<StepOutput> {
  const prompt = assembleAgentPrompt(
    step,
    context,
    outgoingEdgeLabels,
    workdirPath,
    env,
    globalContext,
  );

  // Per-step config overrides global: step agent wins, step flags append to global flags
  const effectiveAgent = step.agentConfig?.agent ?? config.agent;
  const effectiveFlags = [
    ...config.agentFlags,
    ...(step.agentConfig?.flags ?? []),
  ];

  return new Promise<StepOutput>((resolve) => {
    const child = spawn(effectiveAgent, effectiveFlags, {
      cwd: workdirPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });

    child.stdin.write(prompt);
    child.stdin.end();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const parser = createStreamParser();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      const text = chunk.toString("utf-8");
      parser.feed(text);
      if (onOutput) onOutput("stdout", text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (onOutput) onOutput("stderr", chunk.toString("utf-8"));
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      let stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const parsed = parser.finish();

      const hasErrors = parsed.errors.length > 0;
      if (hasErrors) {
        stderr += (stderr.endsWith("\n") || stderr === "" ? "" : "\n") +
          parsed.errors.map((e) => `[markflow] ${e}`).join("\n") + "\n";
      }

      const exitCode = hasErrors ? (code === 0 ? 1 : code ?? 1) : code ?? 1;

      const parsedResult: StepOutput["parsedResult"] = {
        edge: parsed.result?.edge,
        summary: parsed.result?.summary,
        local: Object.keys(parsed.local).length > 0 ? parsed.local : undefined,
        global: Object.keys(parsed.global).length > 0 ? parsed.global : undefined,
        errors: hasErrors ? parsed.errors : undefined,
      };

      resolve({ exitCode, stdout, stderr, parsedResult });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: `Failed to invoke agent "${effectiveAgent}": ${err.message}`,
        parsedResult: undefined,
      });
    });
  });
}

