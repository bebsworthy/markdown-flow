import { spawn } from "node:child_process";
import type {
  StepDefinition,
  StepOutput,
  StepResult,
  MarkflowConfig,
  StepOutputHandler,
} from "../types.js";
import { renderTemplate } from "../template.js";
import { createStreamParser } from "./stream-parser.js";

export function assembleAgentPrompt(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workdirPath: string,
  env: Record<string, string> = {},
): string {
  const contextLines = context
    .map((r) => {
      let line = `- ${r.node} (${r.type}): ${r.summary}`;
      if (r.state) line += `\n  State: ${JSON.stringify(r.state)}`;
      return line;
    })
    .join("\n");

  const validEdges =
    outgoingEdgeLabels.length === 1
      ? `If there is only one outgoing edge, use: done`
      : `Valid edge values: ${outgoingEdgeLabels.join(", ")}`;

  const renderedContent = renderTemplate(step.content, env, step.id);

  return `## Workflow Context

Completed steps:
${contextLines || "(none)"}

Current working directory: ${workdirPath}

---

## Your Task

${renderedContent}

---

You may emit zero or more state/global lines anywhere in your response:

STATE: {"key": "value", ...}
GLOBAL: {"key": "value", ...}

Multiple STATE lines shallow-merge (later keys win); same for GLOBAL.
STATE is scoped to this step; GLOBAL is visible to all subsequent steps.

The very last line of your response MUST be:

RESULT: {"edge": "<label>", "summary": "<one sentence describing what you did>"}

Do NOT include "state" or "global" keys inside RESULT — they are their own lines.

${validEdges}`;
}

export async function runAgent(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workdirPath: string,
  config: MarkflowConfig,
  env: Record<string, string> = {},
  onOutput?: StepOutputHandler,
): Promise<StepOutput> {
  const prompt = assembleAgentPrompt(
    step,
    context,
    outgoingEdgeLabels,
    workdirPath,
    env,
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
        state: Object.keys(parsed.state).length > 0 ? parsed.state : undefined,
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

