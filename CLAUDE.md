# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is an **npm workspaces monorepo** (`packages/*`):

| Package | Path | Description |
|---|---|---|
| `markflow` | `packages/markflow/` | Workflow engine + `markflow` CLI (library export + binary) |
| `markflow-tui` | `packages/markflow-tui/` | Ink-based terminal UI (`markflow-tui` binary); depends on `markflow` |

Root-level `docs/` holds shared architecture docs; `docs/tui/` holds TUI plans, mockups, and feature specs.

## Commands

Run from the repo root — scripts fan out across workspaces via `--workspaces --if-present`:

```bash
npm run build       # Build all packages with tsup (outputs to each package's dist/)
npm run dev         # Run the markflow CLI directly via tsx (engine package)
npm run test        # Run all tests with vitest across workspaces
npm run test:watch  # Watch mode
npm run lint        # TypeScript type checking (tsc --noEmit) across workspaces
```

Scope to a single package with `-w`:

```bash
npm run build -w packages/markflow-tui
npm run test  -w packages/markflow
npm run dev   -w packages/markflow-tui    # ink hot-reload via tsx watch
```

Run a single test file:

```bash
npx vitest run packages/markflow/test/core/engine.test.ts
npx vitest run packages/markflow-tui/test/runs/derive.test.ts
```

## Architecture

**markflow** is a workflow engine that treats a single Markdown file as both documentation and executable spec. Workflows define topology via Mermaid flowcharts and step logic via shell scripts or AI agent prompts. **markflow-tui** is a terminal UI that browses workflows and visualizes live/historical runs by consuming the engine's event stream.

For deep reference on any of the subsystems below, see `docs/arch/`:
- [`event-sourced-run-log.md`](docs/arch/event-sourced-run-log.md) — event stream, replay, sidecar transcripts
- [`routing-and-retries.md`](docs/arch/routing-and-retries.md) — edge resolution, retry budgets, timeouts
- [`configuration.md`](docs/arch/configuration.md) — config precedence, per-step overrides, retry policies
- [`templating-and-context.md`](docs/arch/templating-and-context.md) — LiquidJS, `LOCAL`/`GLOBAL`/`STEPS`
- [`testing-harness.md`](docs/arch/testing-harness.md) — `WorkflowTest` mock-driven harness

### Execution Model

The engine uses a **token-based model**: tokens flow through graph nodes with states (pending → running → complete/skipped).

- **Fan-out:** Multiple unlabeled edges from a node execute in parallel.
- **Fan-in:** Nodes with multiple incoming edges wait for all upstream to complete.
- **Routing:** Exit code 0 → success path, non-zero → failure path. Scripts and agents can emit `RESULT: {"edge": "...", "summary": "..."}` on stdout for explicit routing.
- **Retries:** Two mechanisms. Edge-level `fail max:N` + `fail:max` exhaustion handler (graph-visible), or step-level `retry:` policy in a step's ` ```config ` block (in-place re-run with backoff/jitter). Step-level wins when both are present.
- **Timeouts:** Per-step `timeout:` or workflow-level `timeout_default`. On timeout the step exits 124 and routes via `fail`.

### Run Persistence

Runs are **event-sourced**. Every state mutation is first appended to `runs/<id>/events.jsonl` with a monotonic `seq`, then applied in memory (**append → mutate → dispatch** write-ahead rule). Step stdout/stderr is tee'd to sidecar files in `runs/<id>/output/` keyed by the `seq` of the owning `step:start` event. A pure `replay()` function folds the event stream back into an `EngineSnapshot`; `RunManager.getRun` uses this as the source of truth. `meta.json` is a write-through cache for fast listing only.

### Engine Modules (`packages/markflow/src/`)

| Module | Responsibility |
|---|---|
| `core/parser/` | Extract sections from Markdown, parse Mermaid flowchart topology |
| `core/engine.ts` | `WorkflowEngine` class — token-based execution; `record()` / `emit()` enforce write-ahead ordering |
| `core/router.ts` | Edge resolution and retry state accounting (pure decisions) |
| `core/validator.ts` | Structural validation (node/step correspondence, edge labels, retry completeness) |
| `core/runner/` | `runStep()` dispatcher → `script.ts` (bash/python/js) or `agent.ts` (prose prompts) |
| `core/event-logger.ts` | Append-only event stream; assigns monotonic `seq`; serializes appends |
| `core/replay.ts` | Pure fold from `EngineEvent[]` → `EngineSnapshot`; strict, deterministic |
| `core/run-manager.ts` | Run directory lifecycle; projects events through `replay()` into `RunInfo` |
| `core/retry.ts` | Backoff/jitter computation for step-level retries |
| `core/duration.ts` | Duration-string parsing for timeouts and retry delays |
| `core/types.ts` | All shared types: `Token`, `StepResult`, `RunInfo`, `EngineEvent`, `EngineSnapshot`, etc. |
| `cli/` | yargs CLI with commands: `init`, `run`, `ls`, `show` |

### TUI Modules (`packages/markflow-tui/src/`)

The TUI is a React + [Ink](https://github.com/vadimdemedes/ink) app. Pure logic (derivation, sorting, filtering, reducers) is kept out of components and unit-tested in isolation.

| Module | Responsibility |
|---|---|
| `cli.tsx` / `cli-args.ts` | Binary entrypoint; parses flags and mounts the root app |
| `app.tsx` | Root component; wires modes, keybindings, and screen composition |
| `theme/` | Colors, spacing, and styling primitives for Ink views |
| `components/` | Shared presentational Ink components |
| `state/` | Top-level app reducer + types (modes, selection, focus) |
| `browser/` | Workflow browser: resolver, list & preview layouts |
| `runs/` | Runs table: derive/sort/filter/window, columns, cursor, duration formatting |
| `steps/` | Step table for a single run: derive, aggregate, upstream, tree, retry, columns |
| `engine/` | Adapter that subscribes to `markflow` engine events and feeds the reducer |
| `registry/` | Persistent on-disk registry (atomic write) for known workflows/runs |
| `add-modal/` | Modal flow for adding a workflow to the registry |
| `hooks/` | Custom React/Ink hooks |

See `docs/tui/plan.md` for the phased delivery plan, `docs/tui/features.md` for the feature catalogue, `docs/tui/mockups.md` for UI references, and `docs/tui/testing.md` for the TUI test strategy. VHS tapes for terminal recordings live in `packages/markflow-tui/vhs/`.

### Public API (library consumers)

Exported from `packages/markflow/src/core/index.ts` (package entry `markflow`):
- `parseWorkflow(filePath)` — read and parse a workflow file (async)
- `parseWorkflowFromString(source, filePath?)` — parse an in-memory markdown string
- `validateWorkflow(workflow)` — structural validation
- `executeWorkflow(workflow, options)` — run with event callbacks
- `createRunManager(dir)` — manage run persistence

The TUI package consumes these directly via its `"markflow": "*"` workspace dependency.

### Workflow File Format

Up to four Markdown sections:
1. `# Title` + description (optional) — top-level H1 + prose
2. `# Inputs` (optional) — declared parameters with types/defaults
3. `# Flow` — Mermaid flowchart defining graph topology
4. `# Steps` — named step definitions (fenced code = script; plain prose = agent prompt)

### Build Output

Each package has its own `tsup` config producing ESM output under `packages/<pkg>/dist/`:

- `packages/markflow/dist/core/index.js` — engine library export
- `packages/markflow/dist/cli/index.js` — `markflow` CLI binary (shebang injected)
- `packages/markflow-tui/dist/cli.js` — `markflow-tui` binary (shebang injected)
