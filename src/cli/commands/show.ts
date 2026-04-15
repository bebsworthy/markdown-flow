import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRunManager, readEventLog } from "../../core/index.js";
import { readMarkflowJson } from "../workspace.js";

export interface ShowOptions {
  workspace?: string;
  runsDir?: string;
  json?: boolean;
  events?: boolean;
  output?: number;
}

export async function showCommand(id: string, options: ShowOptions): Promise<void> {
  const runsDir = options.runsDir ?? (options.workspace ? join(options.workspace, "runs") : "./runs");
  const runPath = join(runsDir, id);

  if (options.events) {
    const events = await readEventLog(runPath);
    if (options.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }
    for (const e of events) {
      console.log(
        chalk.dim(`[${String(e.seq).padStart(4, "0")}]`) +
          ` ${chalk.cyan(e.type)} ${chalk.dim(e.ts)}`,
      );
    }
    return;
  }

  if (options.output !== undefined) {
    const targetSeq = options.output;
    const events = await readEventLog(runPath);
    const refs = events.filter(
      (e) => e.type === "output:ref" && e.stepSeq === targetSeq,
    );
    if (refs.length === 0) {
      console.error(
        chalk.red(`No output:ref found for step:start seq=${targetSeq}`),
      );
      process.exit(1);
    }
    for (const r of refs) {
      if (r.type !== "output:ref") continue;
      console.log(chalk.bold(`── ${r.stream} (${r.path}) ──`));
      const contents = await readFile(r.path, "utf-8");
      process.stdout.write(contents);
      if (!contents.endsWith("\n")) console.log();
    }
    return;
  }

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
  if (options.workspace) {
    const meta = await readMarkflowJson(options.workspace);
    if (meta?.origin?.type === "url") {
      console.log(`Origin:   ${meta.origin.url} (fetched ${meta.origin.fetchedAt})`);
    } else if (meta?.origin?.type === "stdin") {
      console.log(`Origin:   <stdin> (received ${meta.origin.receivedAt})`);
    }
  }
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
