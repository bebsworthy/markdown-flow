import chalk from "chalk";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  createRunManager,
  executeWorkflow,
  parseWorkflow,
  replay,
  readEventLog,
  RunLockedError,
  type EngineEvent,
} from "../../core/index.js";
import { parseInputFlags } from "../workspace.js";
import { renderEvent, statusToExitCode } from "../render-events.js";

export interface ResumeOptions {
  workspace?: string;
  input?: string[];
  rerun?: string[];
  json?: boolean;
  verbose?: boolean;
}

export async function resumeCommand(
  runIdPrefix: string,
  options: ResumeOptions,
): Promise<void> {
  if (!options.workspace) {
    console.error(chalk.red("resume: --workspace is required"));
    process.exit(1);
  }
  const workspaceDir = options.workspace;
  const runsDir = join(workspaceDir, "runs");

  const runId = await resolveRunIdPrefix(runsDir, runIdPrefix);

  // Replay to validate the run is in a resumable state before opening.
  const events = await readEventLog(join(runsDir, runId));
  const snapshot = replay(events);
  if (snapshot.status !== "error" && snapshot.status !== "suspended") {
    console.error(
      chalk.red(
        `error: run ${runId} has status "${snapshot.status}" — only error or suspended runs can be resumed`,
      ),
    );
    process.exit(1);
  }

  const manager = createRunManager(runsDir);
  let handle;
  try {
    handle = await manager.openExistingRun(runId);
  } catch (err) {
    if (err instanceof RunLockedError) {
      console.error(
        chalk.red(
          `error: run ${err.runId} is already being resumed. ` +
            `If this is stale, remove ${err.lockPath} manually.`,
        ),
      );
      process.exit(1);
    }
    throw err;
  }

  const meta = await manager.getRun(runId);
  if (!meta) {
    console.error(chalk.red(`error: meta.json missing for ${runId}`));
    process.exit(1);
  }
  const workflow = await parseWorkflow(meta.sourceFile);

  // --rerun: append token:reset events for specified steps
  if (options.rerun?.length) {
    const tokensByNode = new Map<string, string>();
    for (const [id, tok] of handle.snapshot.tokens) {
      tokensByNode.set(tok.nodeId, id);
    }

    for (const step of options.rerun) {
      const tokenId = tokensByNode.get(step);
      if (!tokenId) {
        console.error(
          chalk.red(
            `error: --rerun "${step}" does not match any token in the run`,
          ),
        );
        process.exit(1);
      }
      await handle.runDir.events.append({
        type: "token:reset",
        v: 1,
        tokenId,
      });
    }
  }

  // --input: append global:update event so overrides are auditable
  let inputs: Record<string, string> = {};
  try {
    inputs = parseInputFlags(options.input);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  if (Object.keys(inputs).length > 0) {
    await handle.runDir.events.append({
      type: "global:update",
      keys: Object.keys(inputs),
      patch: inputs,
    });
  }

  const jsonMode = options.json ?? false;
  const verbose = options.verbose ?? false;
  const onEvent = (e: EngineEvent) => {
    renderEvent(e, { verbose, json: jsonMode }, runId);
  };

  const runInfo = await executeWorkflow(workflow, {
    runsDir,
    workspaceDir,
    resumeFrom: handle,
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
      chalk.red(
        `error: "${prefix}" is ambiguous: matches ${matches.join(", ")}`,
      ),
    );
    process.exit(1);
  }
  return matches[0];
}
