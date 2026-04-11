#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCommand } from "./commands/start.js";
import { lsCommand } from "./commands/ls.js";
import { runCommand } from "./commands/run.js";

yargs(hideBin(process.argv))
  .scriptName("markflow")
  .usage("$0 <command> [options]")
  .command(
    "start <file>",
    "Parse, validate and execute a workflow",
    (y) =>
      y
        .positional("file", {
          type: "string",
          describe: "Path to the workflow .md file",
          demandOption: true,
        })
        .option("dry-run", {
          type: "boolean",
          describe: "Parse and validate only, do not execute",
          default: false,
        })
        .option("parallel", {
          type: "boolean",
          describe: "Enable parallel execution of fan-out nodes",
          default: true,
        })
        .option("agent", {
          type: "string",
          describe: "Agent CLI to use (claude, codex)",
        })
        .option("runs-dir", {
          type: "string",
          describe: "Directory for run data",
          default: "./runs",
        }),
    async (argv) => {
      await startCommand(argv.file!, {
        dryRun: argv.dryRun,
        parallel: argv.parallel,
        agent: argv.agent,
        runsDir: argv.runsDir,
      });
    },
  )
  .command(
    "ls",
    "List workflow runs",
    (y) =>
      y
        .option("runs-dir", {
          type: "string",
          describe: "Directory for run data",
          default: "./runs",
        })
        .option("json", {
          type: "boolean",
          describe: "Output as JSON",
          default: false,
        }),
    async (argv) => {
      await lsCommand({ runsDir: argv.runsDir, json: argv.json });
    },
  )
  .command(
    "run <id>",
    "Show details of a specific run",
    (y) =>
      y
        .positional("id", {
          type: "string",
          describe: "Run ID (timestamp)",
          demandOption: true,
        })
        .option("runs-dir", {
          type: "string",
          describe: "Directory for run data",
          default: "./runs",
        })
        .option("json", {
          type: "boolean",
          describe: "Output as JSON",
          default: false,
        }),
    async (argv) => {
      await runCommand(argv.id!, { runsDir: argv.runsDir, json: argv.json });
    },
  )
  .demandCommand(1, "Please specify a command")
  .strict()
  .help()
  .parse();
