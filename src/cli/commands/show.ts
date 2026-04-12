import chalk from "chalk";
import { join } from "node:path";
import { createRunManager } from "../../core/index.js";

export interface ShowOptions {
  workspace?: string;
  runsDir?: string;
  json?: boolean;
}

export async function showCommand(id: string, options: ShowOptions): Promise<void> {
  const runsDir = options.runsDir ?? (options.workspace ? join(options.workspace, "runs") : "./runs");
  const manager = createRunManager(runsDir);
  const runInfo = await manager.getRun(id);

  if (!runInfo) {
    console.error(chalk.red(`Run not found: ${id}`));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(runInfo, null, 2));
    return;
  }

  const statusColor =
    runInfo.status === "complete"
      ? chalk.green
      : runInfo.status === "error"
        ? chalk.red
        : chalk.yellow;

  console.log(chalk.bold(`Workflow: ${runInfo.workflowName}`));
  console.log(`Source:   ${runInfo.sourceFile}`);
  console.log(`Status:   ${statusColor(runInfo.status)}`);
  console.log(`Started:  ${runInfo.startedAt}`);
  if (runInfo.completedAt) {
    console.log(`Finished: ${runInfo.completedAt}`);
  }
  console.log();

  if (runInfo.steps.length === 0) {
    console.log(chalk.dim("  No steps recorded."));
    return;
  }

  console.log(chalk.bold("Steps:"));
  for (const step of runInfo.steps) {
    const icon = step.exit_code === 0 || step.exit_code === null ? "✓" : "✗";
    const color =
      step.exit_code === 0 || step.exit_code === null ? chalk.green : chalk.red;
    console.log(
      color(`  ${icon} ${step.node}`) + chalk.dim(` (${step.type})`) + ` → ${step.edge}`,
    );
    if (step.summary) {
      console.log(chalk.dim(`    ${step.summary}`));
    }
  }
}
