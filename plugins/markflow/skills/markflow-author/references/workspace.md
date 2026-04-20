# Workspace and .env

How markflow initializes, persists, and resolves workspace state.

## What `markflow init` does

1. Creates a workspace directory (default: `./<workflow-name>/` alongside the workflow file).
2. Writes `.markflow.json` with provenance metadata (workflow path, origin URL if remote).
3. Scaffolds a `.env` file pre-filled with every declared input (commented-out with descriptions).

## .env auto-loading

At runtime, `markflow run` resolves inputs in this priority (highest first):

1. `--input KEY=VALUE` CLI flags
2. `--env <file>` explicit env file
3. Workspace `.env`
4. Process environment variables
5. Declared defaults from `# Inputs`

**Only declared inputs are loaded from `.env`.** Undeclared keys in `.env` are ignored — you can safely store notes or commented lines there.

## Secret masking

Inputs whose names match `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i` are auto-masked in run metadata and event logs. The value is still available to steps as a normal env var.

## Workspace reuse

Once initialized, `markflow run <workspace-dir>` (without a `.md` path) re-runs the linked workflow. The workspace persists `.env`, `runs/`, and `.markflow.json` across runs.
