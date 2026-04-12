import { resolve } from "node:path";
import chalk from "chalk";
import {
  parseWorkflow,
  validateWorkflow,
  executeWorkflow,
  type EngineEvent,
} from "../../core/index.js";
import { parseInputFlags } from "../workspace.js";

export interface StartOptions {
  dryRun?: boolean;
  parallel?: boolean;
  agent?: string;
  runsDir?: string;
  envFile?: string;
  input?: string[];
}

export async function startCommand(
  file: string,
  options: StartOptions,
): Promise<void> {
  const filePath = resolve(file);

  // Parse
  let definition;
  try {
    definition = await parseWorkflow(filePath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Parse error: ${msg}`));
    process.exit(1);
  }

  console.log(chalk.bold(`Workflow: ${definition.name}`));
  if (definition.description) {
    console.log(chalk.dim(definition.description));
  }
  console.log();

  // Validate
  const diagnostics = validateWorkflow(definition);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  for (const w of warnings) {
    console.warn(chalk.yellow(`  warning: ${w.message}`));
  }
  for (const e of errors) {
    console.error(chalk.red(`  error: ${e.message}`));
  }

  if (errors.length > 0) {
    console.error(
      chalk.red(`\n${errors.length} error(s) found. Workflow cannot run.`),
    );
    process.exit(1);
  }

  if (diagnostics.length === 0) {
    console.log(chalk.green("  Validation passed"));
  }
  console.log();

  if (options.dryRun) {
    console.log(chalk.green("Dry run complete. Workflow is valid."));
    console.log(
      `  Nodes: ${definition.graph.nodes.size}, Edges: ${definition.graph.edges.length}`,
    );
    const stepTypes = [...definition.steps.values()];
    const scripts = stepTypes.filter((s) => s.type === "script").length;
    const agents = stepTypes.filter((s) => s.type === "agent").length;
    console.log(`  Steps: ${scripts} script, ${agents} agent`);
    return;
  }

  // Execute
  const configOverrides: Record<string, unknown> = {};
  if (options.parallel !== undefined) configOverrides.parallel = options.parallel;
  if (options.agent) configOverrides.agent = options.agent;

  // Parse --input KEY=VALUE entries into a record
  let inputs: Record<string, string>;
  try {
    inputs = parseInputFlags(options.input);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const runInfo = await executeWorkflow(definition, {
    config: configOverrides,
    runsDir: options.runsDir,
    envFile: options.envFile,
    inputs,
    onEvent: printEvent,
  });

  console.log();
  const statusColor = runInfo.status === "complete" ? chalk.green : chalk.red;
  console.log(
    statusColor(
      `Run ${runInfo.id} finished with status: ${runInfo.status}`,
    ),
  );
}

function printEvent(event: EngineEvent): void {
  switch (event.type) {
    case "step:start":
      console.log(chalk.blue(`  ▶ ${event.nodeId}`));
      break;
    case "step:complete":
      console.log(
        chalk.green(
          `  ✓ ${event.nodeId} → ${event.result.edge}: ${event.result.summary || "(no summary)"}`,
        ),
      );
      break;
    case "route":
      console.log(
        chalk.dim(
          `    ${event.from} → ${event.to}${event.edge ? ` [${event.edge}]` : ""}`,
        ),
      );
      break;
    case "retry:increment":
      console.log(
        chalk.yellow(
          `  ↻ ${event.nodeId} retry ${event.count}/${event.max} (${event.label})`,
        ),
      );
      break;
    case "retry:exhausted":
      console.log(
        chalk.red(`  ✗ ${event.nodeId} retries exhausted (${event.label})`),
      );
      break;
    case "workflow:error":
      console.error(chalk.red(`  Error: ${event.error}`));
      break;
    case "workflow:complete":
      break;
  }
}
