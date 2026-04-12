import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StepDefinition, StepOutput, StepOutputHandler } from "../types.js";

const LANG_TO_INTERPRETER: Record<string, string> = {
  bash: "bash",
  sh: "bash",
  python: "python3",
  js: "node",
  javascript: "node",
};

const LANG_TO_EXT: Record<string, string> = {
  bash: ".sh",
  sh: ".sh",
  python: ".py",
  js: ".js",
  javascript: ".js",
};

export async function runScript(
  step: StepDefinition,
  env: Record<string, string>,
  workdirPath: string,
  runDir: string,
  onOutput?: StepOutputHandler,
): Promise<StepOutput> {
  const lang = step.lang ?? "bash";
  const interpreter = LANG_TO_INTERPRETER[lang];
  const ext = LANG_TO_EXT[lang];

  // Write script to a temp file in the run directory
  const scriptsDir = join(runDir, "scripts");
  await mkdir(scriptsDir, { recursive: true });
  const scriptPath = join(scriptsDir, `${step.id}${ext}`);
  await writeFile(scriptPath, step.content, "utf-8");

  return new Promise<StepOutput>((resolve) => {
    const child = spawn(interpreter, [scriptPath], {
      cwd: workdirPath,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

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
        stderr: err.message,
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
        return {
          edge: parsed.edge,
          summary: parsed.summary,
        };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
