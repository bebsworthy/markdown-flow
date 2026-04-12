import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import { parseWorkflow } from "../../core/index.js";
import {
  resolveTarget,
  readMarkflowJson,
  writeMarkflowJson,
  generateEnvContent,
  updateEnvContent,
  parseInputFlags,
  workflowRelativePath,
} from "../workspace.js";

export interface InitOptions {
  workspace?: string;
  input?: string[];
  force?: boolean;
  remove?: boolean;
}

export async function initCommand(
  target: string,
  options: InitOptions,
): Promise<void> {
  let workflowPath: string;
  let workspaceDir: string;
  let workspaceExists: boolean;

  try {
    ({ workflowPath, workspaceDir, workspaceExists } = await resolveTarget(
      target,
      options.workspace,
    ));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Parse --input flags
  let provided: Record<string, string>;
  try {
    provided = parseInputFlags(options.input);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Parse the workflow to get declared inputs
  let definition;
  try {
    definition = await parseWorkflow(workflowPath);
  } catch (err) {
    console.error(chalk.red(`Parse error: ${(err as Error).message}`));
    process.exit(1);
  }

  const relWorkflow = workflowRelativePath(workspaceDir, workflowPath);

  if (!workspaceExists) {
    // ── Create mode ────────────────────────────────────────────────────���─────
    await mkdir(workspaceDir, { recursive: true });
    await writeMarkflowJson(workspaceDir, relWorkflow);
    const envContent = generateEnvContent(definition.name, definition.inputs, provided);
    await writeFile(resolve(workspaceDir, ".env"), envContent, "utf-8");

    console.log(chalk.green(`Workspace created: ${workspaceDir}`));
    console.log(chalk.dim(`  Workflow: ${relWorkflow}`));
    console.log(chalk.dim(`  Edit ${workspaceDir}/.env to configure inputs.`));
  } else {
    // ── Update mode ───────────────────────────────────────────────────────────
    const existing = await readMarkflowJson(workspaceDir);
    const existingWorkflow = existing?.workflow;

    if (existingWorkflow && existingWorkflow !== relWorkflow) {
      if (!options.force) {
        console.error(
          chalk.red(
            `Workspace "${workspaceDir}" is already linked to "${existingWorkflow}".\n` +
              `Use --force to overwrite.`,
          ),
        );
        process.exit(1);
      }
      await writeMarkflowJson(workspaceDir, relWorkflow);
      console.log(chalk.yellow(`  Workflow updated: ${existingWorkflow} → ${relWorkflow}`));
    }

    // Update .env
    const envPath = resolve(workspaceDir, ".env");
    let currentEnv = "";
    try {
      currentEnv = await readFile(envPath, "utf-8");
    } catch {
      // .env doesn't exist yet — start fresh
      currentEnv = generateEnvContent(definition.name, definition.inputs, {});
    }

    const updatedEnv = updateEnvContent(
      currentEnv,
      definition.inputs,
      provided,
      options.remove ?? false,
    );
    await writeFile(envPath, updatedEnv, "utf-8");

    const updatedKeys = Object.keys(provided);
    console.log(chalk.green(`Workspace updated: ${workspaceDir}`));
    if (updatedKeys.length > 0) {
      for (const k of updatedKeys) {
        console.log(chalk.dim(`  ${k}=${provided[k]}`));
      }
    }
  }
}
