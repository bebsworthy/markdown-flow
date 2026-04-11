import { spawn } from "node:child_process";
import type { StepDefinition, StepResult, StepOutput, MarkflowConfig } from "../types.js";

export function assembleAgentPrompt(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workspacePath: string,
): string {
  const contextLines = context
    .map((r) => `- ${r.node} (${r.type}): ${r.summary}`)
    .join("\n");

  const validEdges =
    outgoingEdgeLabels.length === 1
      ? `If there is only one outgoing edge, use: done`
      : `Valid edge values: ${outgoingEdgeLabels.join(", ")}`;

  return `## Workflow Context

Completed steps:
${contextLines || "(none)"}

Current working directory: ${workspacePath}

---

## Your Task

${step.content}

---

When complete, output the following as the very last line of your response:

RESULT: {"edge": "<label>", "summary": "<one sentence describing what you did>"}

${validEdges}`;
}

export async function runAgent(
  step: StepDefinition,
  context: StepResult[],
  outgoingEdgeLabels: string[],
  workspacePath: string,
  config: MarkflowConfig,
): Promise<StepOutput> {
  const prompt = assembleAgentPrompt(
    step,
    context,
    outgoingEdgeLabels,
    workspacePath,
  );

  return new Promise<StepOutput>((resolve) => {
    const args = [...config.agentFlags, "--prompt", prompt];
    const child = spawn(config.agent, args, {
      cwd: workspacePath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

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
        stderr: `Failed to invoke agent "${config.agent}": ${err.message}`,
        parsedResult: undefined,
      });
    });
  });
}

function parseResultLine(
  stdout: string,
): { edge?: string; summary?: string } | undefined {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^RESULT:\s*(\{.*\})\s*$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return { edge: parsed.edge, summary: parsed.summary };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
