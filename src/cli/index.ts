#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { showCommand } from "./commands/show.js";
import { lsCommand } from "./commands/ls.js";
import { pendingCommand } from "./commands/pending.js";
import { approveCommand } from "./commands/approve.js";
import { resumeCommand } from "./commands/resume.js";

yargs(hideBin(process.argv))
  .scriptName("markflow")
  .usage("$0 <command> [options]")

  // ── init ──────────────────────────────────────────────────────────────────
  .command(
    "init <target>",
    "Create or update a workflow workspace",
    (y) =>
      y
        .positional("target", {
          type: "string",
          describe: "Workflow .md file or existing workspace directory",
          demandOption: true,
        })
        .option("workspace", {
          type: "string",
          alias: "w",
          describe: "Workspace directory (default: ./<workflow-name>)",
        })
        .option("input", {
          type: "string",
          array: true,
          describe: "Set an input value (KEY=VALUE), repeatable",
        })
        .option("force", {
          type: "boolean",
          default: false,
          describe: "Allow re-linking workspace to a different workflow",
        })
        .option("remove", {
          type: "boolean",
          default: false,
          describe: "Remove .env keys no longer declared in the workflow",
        }),
    async (argv) => {
      await initCommand(argv.target!, {
        workspace: argv.workspace,
        input: argv.input,
        force: argv.force,
        remove: argv.remove,
      });
    },
  )

  // ── run ───────────────────────────────────────────────────────────────────
  .command(
    "run <target>",
    "Execute a workflow (auto-inits workspace if needed)",
    (y) =>
      y
        .positional("target", {
          type: "string",
          describe: "Workflow .md file or workspace directory",
          demandOption: true,
        })
        .option("workspace", {
          type: "string",
          alias: "w",
          describe: "Workspace directory (default: ./<workflow-name>)",
        })
        .option("env", {
          type: "string",
          describe: "Extra env file (overrides workspace .env, overridden by --input)",
        })
        .option("input", {
          type: "string",
          array: true,
          describe: "Input override (KEY=VALUE), repeatable",
        })
        .option("dry-run", {
          type: "boolean",
          default: false,
          describe: "Validate only, do not execute",
        })
        .option("parallel", {
          type: "boolean",
          default: true,
          describe: "Enable parallel execution of fan-out nodes",
        })
        .option("agent", {
          type: "string",
          describe: "Override agent CLI",
        })
        .option("verbose", {
          type: "boolean",
          alias: "v",
          default: false,
          describe: "Stream each step's stdout/stderr to the console",
        })
        .option("debug", {
          type: "boolean",
          default: false,
          describe: "Pause before each step for interactive inspection",
        })
        .option("break-on", {
          type: "string",
          describe: "Run until the named step, then pause (implies --debug)",
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output events and result as JSON lines",
        }),
    async (argv) => {
      await runCommand(argv.target!, {
        workspace: argv.workspace,
        env: argv.env,
        input: argv.input,
        dryRun: argv.dryRun,
        parallel: argv.parallel,
        agent: argv.agent,
        verbose: argv.verbose,
        debug: argv.debug,
        breakOn: argv.breakOn,
        json: argv.json,
      });
    },
  )

  // ── ls ────────────────────────────────────────────────────────────────────
  .command(
    "ls <workspace>",
    "List runs in a workspace",
    (y) =>
      y
        .positional("workspace", {
          type: "string",
          describe: "Workspace directory",
          demandOption: true,
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output as JSON",
        }),
    async (argv) => {
      await lsCommand(argv.workspace!, { json: argv.json });
    },
  )

  // ── show ──────────────────────────────────────────────────────────────────
  .command(
    "show <id>",
    "Show details of a specific run",
    (y) =>
      y
        .positional("id", {
          type: "string",
          describe: "Run ID (timestamp)",
          demandOption: true,
        })
        .option("workspace", {
          type: "string",
          alias: "w",
          describe: "Workspace directory containing the run",
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output as JSON",
        })
        .option("events", {
          type: "boolean",
          default: false,
          describe: "Dump the raw event timeline (events.jsonl)",
        })
        .option("output", {
          type: "number",
          describe: "Print the sidecar output file produced at the given step:start seq",
        }),
    async (argv) => {
      await showCommand(argv.id!, {
        workspace: argv.workspace,
        json: argv.json,
        events: argv.events,
        output: argv.output,
      });
    },
  )

  // ── pending ───────────────────────────────────────────────────────────────
  .command(
    "pending <workspace>",
    "List runs waiting for approval",
    (y) =>
      y
        .positional("workspace", {
          type: "string",
          describe: "Workspace directory",
          demandOption: true,
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output as JSON",
        }),
    async (argv) => {
      await pendingCommand(argv.workspace!, { json: argv.json });
    },
  )

  // ── approve ───────────────────────────────────────────────────────────────
  .command(
    "approve <run> <node> <choice>",
    "Decide a pending approval and resume the run",
    (y) =>
      y
        .positional("run", {
          type: "string",
          describe: "Run ID (or unique prefix)",
          demandOption: true,
        })
        .positional("node", {
          type: "string",
          describe: "Approval node ID",
          demandOption: true,
        })
        .positional("choice", {
          type: "string",
          describe: "Option to choose (must appear in the node's options)",
          demandOption: true,
        })
        .option("workspace", {
          type: "string",
          alias: "w",
          describe: "Workspace directory containing the run",
          demandOption: true,
        })
        .option("as", {
          type: "string",
          describe: "Record this actor as decidedBy (default: $USER)",
        })
        .option("verbose", {
          type: "boolean",
          alias: "v",
          default: false,
          describe: "Stream each step's stdout/stderr to the console",
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output events and result as JSON lines",
        }),
    async (argv) => {
      await approveCommand(argv.run!, argv.node!, argv.choice!, {
        workspace: argv.workspace,
        as: argv.as,
        verbose: argv.verbose,
        json: argv.json,
      });
    },
  )

  // ── resume ─────────────────────────────────────────────────────────────
  .command(
    "resume <run>",
    "Resume a failed or suspended run from where it stopped",
    (y) =>
      y
        .positional("run", {
          type: "string",
          describe: "Run ID (or unique prefix)",
          demandOption: true,
        })
        .option("workspace", {
          type: "string",
          alias: "w",
          describe: "Workspace directory containing the run",
          demandOption: true,
        })
        .option("input", {
          type: "string",
          array: true,
          describe: "Input override (KEY=VALUE), repeatable",
        })
        .option("rerun", {
          type: "string",
          array: true,
          describe: "Force re-run of a completed step by node ID",
        })
        .option("verbose", {
          type: "boolean",
          alias: "v",
          default: false,
          describe: "Stream each step's stdout/stderr to the console",
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output events and result as JSON lines",
        }),
    async (argv) => {
      await resumeCommand(argv.run!, {
        workspace: argv.workspace,
        input: argv.input,
        rerun: argv.rerun,
        verbose: argv.verbose,
        json: argv.json,
      });
    },
  )

  .demandCommand(1, "Please specify a command")
  .strict()
  .help()
  .parse();
