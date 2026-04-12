import { spawn } from "node:child_process";
import type {
  StepDefinition,
  StepOutput,
  StepResult,
  MarkflowConfig,
  StepOutputHandler,
} from "../types.js";
import { renderTemplate } from "../template.js";

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
      if (r.data) line += `\n  Data: ${JSON.stringify(r.data)}`;
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

When complete, output the following as the very last line of your response:

RESULT: {"edge": "<label>", "summary": "<one sentence describing what you did>", "data": { ... }, "global": { ... }}

The "data" field is optional — use it to pass structured data to downstream steps.
The "global" field is optional — use it to set workflow-wide key-value pairs readable by all subsequent steps.

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

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (onOutput) onOutput("stdout", chunk.toString("utf-8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (onOutput) onOutput("stderr", chunk.toString("utf-8"));
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? 1;

      const parsedResult = parseResultLine(stdout);

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

function parseResultLine(
  stdout: string,
): StepOutput["parsedResult"] | undefined {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^RESULT:\s*(\{.*\})\s*$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return {
          edge: parsed.edge,
          summary: parsed.summary,
          data: parsed.data,
          global: parsed.global,
        };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
