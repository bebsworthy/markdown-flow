import chalk from "chalk";
import type { EngineEvent } from "../core/index.js";

export interface RenderOptions {
  verbose?: boolean;
  /**
   * When true, emit each event as a JSON line on stdout instead of the
   * human-readable rendering. Matches the `--json` CLI flag.
   */
  json?: boolean;
}

/**
 * Event renderer shared by `run` and `approve`. Writes step lifecycle events
 * to stdout (human form) or stdout as JSONL (machine form). Suspend blocks
 * (`step:waiting`) always go to stderr in human mode so stdout pipes stay clean.
 */
export function renderEvent(
  event: EngineEvent,
  opts: RenderOptions = {},
  resumeHint?: string,
): void {
  if (opts.json) {
    console.log(JSON.stringify(event));
    return;
  }
  const verbose = opts.verbose ?? false;

  switch (event.type) {
    case "step:start":
      console.log(chalk.blue(`  ▶ ${event.nodeId}`));
      break;
    case "step:complete":
      console.log(
        chalk.green(`  ✓ ${event.nodeId} → ${event.result.edge}: ${event.result.summary || "(no summary)"}`),
      );
      break;
    case "route":
      console.log(chalk.dim(`    ${event.from} → ${event.to}${event.edge ? ` [${event.edge}]` : ""}`));
      break;
    case "retry:increment":
      console.log(chalk.yellow(`  ↻ ${event.nodeId} retry ${event.count}/${event.max} (${event.label})`));
      break;
    case "retry:exhausted":
      console.log(chalk.red(`  ✗ ${event.nodeId} retries exhausted (${event.label})`));
      break;
    case "workflow:error":
      console.error(chalk.red(`  Error: ${event.error}`));
      break;
    case "workflow:complete":
      break;
    case "step:waiting": {
      const lines = [
        `[markflow] run suspended${resumeHint ? `: ${resumeHint}` : ""}`,
        `[markflow] waiting at node: ${event.nodeId}`,
        `[markflow] prompt: ${event.prompt}`,
        `[markflow] options: ${event.options.join(", ")}`,
      ];
      if (resumeHint) {
        lines.push(
          `[markflow] resume: markflow approve ${resumeHint} ${event.nodeId} <choice>`,
        );
      }
      for (const l of lines) process.stderr.write(`${l}\n`);
      break;
    }
    case "approval:decided":
      console.log(
        chalk.cyan(
          `  ✓ ${event.nodeId} approved: ${event.choice}${event.decidedBy ? ` (by ${event.decidedBy})` : ""}`,
        ),
      );
      break;
    case "step:output":
      if (verbose) {
        const prefix = chalk.dim(`[${event.nodeId}]`);
        const stream = event.stream === "stderr" ? process.stderr : process.stdout;
        const lines = event.chunk.split("\n");
        if (lines[lines.length - 1] === "") lines.pop();
        for (const line of lines) {
          const colored = event.stream === "stderr" ? chalk.yellow(line) : line;
          stream.write(`${prefix} ${colored}\n`);
        }
      }
      break;
  }
}

/**
 * Map a terminal `RunStatus` to the CLI exit code contract:
 *   0 — complete
 *   2 — suspended (waiting on approval)
 *   1 — error or anything else
 */
export function statusToExitCode(status: string): number {
  if (status === "complete") return 0;
  if (status === "suspended") return 2;
  return 1;
}
