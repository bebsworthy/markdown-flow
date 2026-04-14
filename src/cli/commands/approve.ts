import chalk from "chalk";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  createRunManager,
  executeWorkflow,
  parseWorkflow,
  readEventLog,
  type EngineEvent,
} from "../../core/index.js";
import { renderEvent, statusToExitCode } from "../render-events.js";

export interface ApproveOptions {
  workspace?: string;
  as?: string;
  json?: boolean;
  verbose?: boolean;
}

/**
 * Resume a suspended run by deciding an approval node.
 *
 * Validation is read-only: we replay the log to confirm the node is waiting
 * and that the choice is in its last-recorded `options` list. On failure, we
 * exit 1 without appending any events — the engine stays single-writer.
 */
export async function approveCommand(
  runIdPrefix: string,
  nodeId: string,
  choice: string,
  options: ApproveOptions,
): Promise<void> {
  if (!options.workspace) {
    console.error(
      chalk.red("approve: --workspace is required"),
    );
    process.exit(1);
  }
  const workspaceDir = options.workspace;
  const runsDir = join(workspaceDir, "runs");

  const runId = await resolveRunIdPrefix(runsDir, runIdPrefix);

  const events = await readEventLog(join(runsDir, runId));

  // Find the most recent step:waiting for this node, plus any later decision.
  let lastWaiting: Extract<EngineEvent, { type: "step:waiting" }> | undefined;
  let decidedAfter = -1;
  for (const e of events) {
    if (e.type === "step:waiting" && e.nodeId === nodeId) {
      lastWaiting = e;
      decidedAfter = -1;
    } else if (e.type === "approval:decided" && e.nodeId === nodeId) {
      decidedAfter = e.seq;
    }
  }

  if (!lastWaiting || (decidedAfter > -1 && decidedAfter > lastWaiting.seq)) {
    console.error(
      chalk.red(
        `error: no pending approval for node "${nodeId}" in run ${runId}`,
      ),
    );
    process.exit(1);
  }

  if (!lastWaiting.options.includes(choice)) {
    console.error(
      chalk.red(`error: "${choice}" is not a valid choice for ${nodeId}`),
    );
    console.error(
      chalk.red(`       valid options: ${lastWaiting.options.join(", ")}`),
    );
    process.exit(1);
  }

  const manager = createRunManager(runsDir);
  const handle = await manager.openExistingRun(runId);

  const meta = await manager.getRun(runId);
  if (!meta) {
    console.error(chalk.red(`error: meta.json missing for ${runId}`));
    process.exit(1);
  }
  const workflow = await parseWorkflow(meta.sourceFile);

  const jsonMode = options.json ?? false;
  const verbose = options.verbose ?? false;
  const onEvent = (e: EngineEvent) => {
    renderEvent(e, { verbose, json: jsonMode }, runId);
  };

  const runInfo = await executeWorkflow(workflow, {
    runsDir,
    workspaceDir,
    resumeFrom: handle,
    approvalDecision: {
      nodeId,
      choice,
      decidedBy: options.as ?? process.env.USER,
    },
    onEvent,
  });

  if (jsonMode) {
    console.log(JSON.stringify(runInfo));
  } else {
    console.log();
    const color =
      runInfo.status === "complete"
        ? chalk.green
        : runInfo.status === "suspended"
          ? chalk.yellow
          : chalk.red;
    console.log(
      color(`Run ${runInfo.id} finished with status: ${runInfo.status}`),
    );
    if (runInfo.status === "suspended") {
      process.stderr.write(
        `[markflow] resume: markflow approve ${runInfo.id} <node> <choice>\n`,
      );
    }
  }
  process.exitCode = statusToExitCode(runInfo.status);
}

async function resolveRunIdPrefix(
  runsDir: string,
  prefix: string,
): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    console.error(chalk.red(`error: runs directory not found: ${runsDir}`));
    process.exit(1);
  }
  const matches = entries.filter((e) => e.startsWith(prefix));
  if (matches.length === 0) {
    console.error(chalk.red(`error: no run matches "${prefix}"`));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(
      chalk.red(`error: "${prefix}" is ambiguous: matches ${matches.join(", ")}`),
    );
    process.exit(1);
  }
  return matches[0];
}
