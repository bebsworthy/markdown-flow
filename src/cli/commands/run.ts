import { join } from "node:path";
import chalk from "chalk";
import {
  parseWorkflow,
  validateWorkflow,
  executeWorkflow,
  type EngineEvent,
} from "../../core/index.js";
import {
  resolveTarget,
  parseInputFlags,
} from "../workspace.js";
import { initCommand } from "./init.js";
import { createDebugHook, WorkflowAbortError } from "../debug.js";

export interface RunOptions {
  workspace?: string;
  env?: string;
  input?: string[];
  dryRun?: boolean;
  parallel?: boolean;
  agent?: string;
  debug?: boolean;
  breakOn?: string;
  verbose?: boolean;
}

export async function runCommand(
  target: string,
  options: RunOptions,
): Promise<void> {
  // Resolve workspace + workflow path
  let resolved;
  try {
    resolved = await resolveTarget(target, options.workspace);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const { workflowPath, workspaceDir, workspaceExists } = resolved;

  // Auto-init if workspace doesn't exist
  if (!workspaceExists) {
    console.log(chalk.dim(`Workspace not found — initialising ${workspaceDir}...`));
    await initCommand(target, { workspace: options.workspace });
  }

  // Parse --input flags
  let inputs: Record<string, string>;
  try {
    inputs = parseInputFlags(options.input);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Parse workflow
  let definition;
  try {
    definition = await parseWorkflow(workflowPath);
  } catch (err) {
    console.error(chalk.red(`Parse error: ${(err as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.bold(`Workflow: ${definition.name}`));
  if (definition.description) console.log(chalk.dim(definition.description));
  console.log();

  // Validate
  const diagnostics = validateWorkflow(definition);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  for (const w of warnings) console.warn(chalk.yellow(`  warning: ${w.message}`));
  for (const e of errors) console.error(chalk.red(`  error: ${e.message}`));
  if (errors.length > 0) {
    console.error(chalk.red(`\n${errors.length} error(s) found. Workflow cannot run.`));
    process.exit(1);
  }
  if (diagnostics.length === 0) console.log(chalk.green("  Validation passed"));
  console.log();

  if (options.dryRun) {
    console.log(chalk.green("Dry run complete. Workflow is valid."));
    console.log(`  Nodes: ${definition.graph.nodes.size}, Edges: ${definition.graph.edges.length}`);
    const stepTypes = [...definition.steps.values()];
    console.log(`  Steps: ${stepTypes.filter((s) => s.type === "script").length} script, ${stepTypes.filter((s) => s.type === "agent").length} agent`);
    return;
  }

  // Debug mode: disable parallel (readline + concurrent tokens = deadlock)
  const debugActive = options.debug || options.breakOn !== undefined;
  if (debugActive && options.parallel) {
    console.log(chalk.dim("Debug mode: disabling parallel execution."));
  }

  // Execute
  const configOverrides: Record<string, unknown> = {};
  if (debugActive) {
    configOverrides.parallel = false;
  } else if (options.parallel !== undefined) {
    configOverrides.parallel = options.parallel;
  }
  if (options.agent) configOverrides.agent = options.agent;

  const debugger_ = debugActive
    ? createDebugHook({ breakOn: options.breakOn })
    : undefined;

  const verbose = options.verbose ?? false;
  const onEvent = (e: EngineEvent) => printEvent(e, verbose);

  try {
    const runInfo = await executeWorkflow(definition, {
      config: configOverrides,
      runsDir: join(workspaceDir, "runs"),
      workspaceDir,
      envFile: options.env,
      inputs,
      onEvent,
      beforeStep: debugger_?.hook,
    });

    console.log();
    const statusColor = runInfo.status === "complete" ? chalk.green : chalk.red;
    console.log(
      statusColor(`Run ${runInfo.id} finished with status: ${runInfo.status}`),
    );
  } catch (err) {
    if (err instanceof WorkflowAbortError) {
      console.log(chalk.yellow("\nAborted."));
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    debugger_?.close();
  }
}

function printEvent(event: EngineEvent, verbose = false): void {
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
    case "step:output":
      if (verbose) {
        const prefix = chalk.dim(`[${event.nodeId}]`);
        const stream = event.stream === "stderr" ? process.stderr : process.stdout;
        const lines = event.chunk.split("\n");
        // Drop trailing empty element when chunk ends with newline
        if (lines[lines.length - 1] === "") lines.pop();
        for (const line of lines) {
          const colored = event.stream === "stderr" ? chalk.yellow(line) : line;
          stream.write(`${prefix} ${colored}\n`);
        }
      }
      break;
  }
}
