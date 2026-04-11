import chalk from "chalk";
import { createRunManager } from "../../core/index.js";

export interface LsOptions {
  runsDir?: string;
  json?: boolean;
}

export async function lsCommand(options: LsOptions): Promise<void> {
  const manager = createRunManager(options.runsDir);
  const runs = await manager.listRuns();

  if (runs.length === 0) {
    console.log(chalk.dim("No runs found."));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  // Table header
  console.log(
    chalk.bold(
      padRight("ID", 32) +
        padRight("WORKFLOW", 24) +
        padRight("STATUS", 10) +
        padRight("STEPS", 6) +
        "STARTED",
    ),
  );

  for (const run of runs) {
    const statusColor =
      run.status === "complete"
        ? chalk.green
        : run.status === "error"
          ? chalk.red
          : chalk.yellow;

    console.log(
      padRight(run.id, 32) +
        padRight(run.workflowName, 24) +
        statusColor(padRight(run.status, 10)) +
        padRight(String(run.steps.length), 6) +
        run.startedAt,
    );
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len - 1) + " " : s + " ".repeat(len - s.length);
}
