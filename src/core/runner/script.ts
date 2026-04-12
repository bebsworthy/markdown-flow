import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  StepDefinition,
  StepOutput,
  StepOutputHandler,
} from "../types.js";
import { createStreamParser } from "./stream-parser.js";

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
        stderr: err.message,
        parsedResult: undefined,
      });
    });
  });
}

