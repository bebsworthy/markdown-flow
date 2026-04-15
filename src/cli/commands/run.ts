import { join, basename } from "node:path";
import chalk from "chalk";
import {
  parseWorkflow,
  validateWorkflow,
  executeWorkflow,
  type EngineEvent,
  type ValidationDiagnostic,
  WorkflowAbortError,
} from "../../core/index.js";
import {
  resolveTarget,
  parseInputFlags,
  prepareTarget,
  refreshWorkspaceOrigin,
} from "../workspace.js";
import { initCommand } from "./init.js";
import { createDebugHook } from "../debug.js";
import { renderEvent, statusToExitCode } from "../render-events.js";

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
  json?: boolean;
  refresh?: boolean;
}

export async function runCommand(
  target: string,
  options: RunOptions,
): Promise<void> {
  // Materialize remote / stdin source into the workspace first.
  let prepared;
  try {
    prepared = await prepareTarget(target, options.workspace);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  if (prepared.materialized && prepared.origin) {
    console.log(
      chalk.dim(
        prepared.origin.type === "url"
          ? `Fetched ${prepared.origin.url} → ${prepared.target}`
          : `Read workflow from stdin → ${prepared.target}`,
      ),
    );
  }
  const effectiveTarget = prepared.target;
  const effectiveWorkspace = prepared.workspace;
  const wasMaterialized = prepared.materialized;

  // Resolve workspace + workflow path
  let resolved;
  try {
    resolved = await resolveTarget(effectiveTarget, effectiveWorkspace);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const { workflowPath, workspaceDir, workspaceExists } = resolved;

  // --refresh: re-fetch from recorded URL origin before running.
  if (options.refresh && !wasMaterialized && workspaceExists) {
    try {
      const o = await refreshWorkspaceOrigin(workspaceDir);
      console.log(chalk.dim(`Refreshed ${o.url} → ${workflowPath}`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  } else if (options.refresh && wasMaterialized) {
    // URL target already triggered a fresh fetch via prepareTarget; --refresh is redundant.
    console.log(chalk.dim("(--refresh redundant: target is a URL and was just fetched)"));
  }

  // Auto-init if workspace doesn't exist, or if we just materialized (no .env yet)
  if (!workspaceExists || wasMaterialized) {
    if (!workspaceExists) {
      console.log(chalk.dim(`Workspace not found — initialising ${workspaceDir}...`));
    }
    await initCommand(effectiveTarget, { workspace: effectiveWorkspace });
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

  const jsonMode = options.json ?? false;

  if (!jsonMode) {
    console.log(chalk.bold(`Workflow: ${definition.name}`));
    if (definition.description) console.log(chalk.dim(definition.description));
    console.log();
  }

  // Validate
  const diagnostics = validateWorkflow(definition);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  if (!jsonMode) {
    for (const w of warnings) console.warn(chalk.yellow(`  ${formatDiagnostic(w)}`));
    for (const e of errors) console.error(chalk.red(`  ${formatDiagnostic(e)}`));
  }
  if (errors.length > 0) {
    if (!jsonMode) console.error(chalk.red(`\n${errors.length} error(s) found. Workflow cannot run.`));
    process.exit(1);
  }
  if (!jsonMode && diagnostics.length === 0) console.log(chalk.green("  Validation passed"));
  if (!jsonMode) console.log();

  if (options.dryRun) {
    if (!jsonMode) {
      console.log(chalk.green("Dry run complete. Workflow is valid."));
      console.log(`  Nodes: ${definition.graph.nodes.size}, Edges: ${definition.graph.edges.length}`);
      const stepTypes = [...definition.steps.values()];
      console.log(`  Steps: ${stepTypes.filter((s) => s.type === "script").length} script, ${stepTypes.filter((s) => s.type === "agent").length} agent`);
    }
    return;
  }

  // Debug mode: disable parallel (readline + concurrent tokens = deadlock)
  const debugActive = options.debug || options.breakOn !== undefined;
  if (debugActive && options.parallel && !jsonMode) {
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
  const onEvent = (e: EngineEvent) => {
    renderEvent(e, { verbose, json: jsonMode });
  };

  const abortController = new AbortController();
  const onSignal = () => abortController.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const runInfo = await executeWorkflow(definition, {
      config: configOverrides,
      runsDir: join(workspaceDir, "runs"),
      workspaceDir,
      envFile: options.env,
      inputs,
      onEvent,
      beforeStep: debugger_?.hook,
      signal: abortController.signal,
    });

    if (jsonMode) {
      console.log(JSON.stringify(runInfo));
    } else {
      console.log();
      const statusColor =
        runInfo.status === "complete"
          ? chalk.green
          : runInfo.status === "suspended"
            ? chalk.yellow
            : chalk.red;
      console.log(
        statusColor(`Run ${runInfo.id} finished with status: ${runInfo.status}`),
      );
      if (runInfo.status === "suspended") {
        process.stderr.write(
          `[markflow] resume: markflow approve ${runInfo.id} <node> <choice>\n`,
        );
      } else if (runInfo.status === "error") {
        process.stderr.write(
          `[markflow] resume: markflow resume ${runInfo.id} -w ${workspaceDir}\n`,
        );
      }
    }
    process.exitCode = statusToExitCode(runInfo.status);
  } catch (err) {
    if (err instanceof WorkflowAbortError) {
      if (!jsonMode) console.log(chalk.yellow("\nAborted."));
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    debugger_?.close();
  }
}

function formatDiagnostic(d: ValidationDiagnostic): string {
  const loc = d.source && d.line
    ? `${basename(d.source)}:${d.line}: `
    : d.line
      ? `line ${d.line}: `
      : "";
  const prefix = d.severity === "error" ? "error" : "warning";
  const msg = `${loc}${prefix}: ${d.message}`;
  return d.suggestion ? `${msg}\n    suggestion: ${d.suggestion}` : msg;
}

