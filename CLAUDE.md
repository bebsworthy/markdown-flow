# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # Build with tsup (outputs to dist/)
npm run dev         # Run CLI directly via tsx (no build needed)
npm run test        # Run all tests with vitest
npm run test:watch  # Watch mode for tests
npm run lint        # TypeScript type checking (no eslint configured)
```

Run a single test file:
```bash
npx vitest run test/core/engine.test.ts
```

## Architecture

**markflow** is a workflow engine that treats a single Markdown file as both documentation and executable spec. Workflows define topology via Mermaid flowcharts and step logic via shell scripts or AI agent prompts.

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

### Key Modules

| Module | Responsibility |
|---|---|
| `src/core/parser/` | Extract sections from Markdown, parse Mermaid flowchart topology |
| `src/core/engine.ts` | `WorkflowEngine` class — token-based execution; `record()` / `emit()` enforce write-ahead ordering |
| `src/core/router.ts` | Edge resolution and retry state accounting (pure decisions) |
| `src/core/validator.ts` | Structural validation (node/step correspondence, edge labels, retry completeness) |
| `src/core/runner/` | `runStep()` dispatcher → `script.ts` (bash/python/js) or `agent.ts` (prose prompts) |
| `src/core/event-logger.ts` | Append-only event stream; assigns monotonic `seq`; serializes appends |
| `src/core/replay.ts` | Pure fold from `EngineEvent[]` → `EngineSnapshot`; strict, deterministic |
| `src/core/run-manager.ts` | Run directory lifecycle; projects events through `replay()` into `RunInfo` |
| `src/core/retry.ts` | Backoff/jitter computation for step-level retries |
| `src/core/duration.ts` | Duration-string parsing for timeouts and retry delays |
| `src/core/types.ts` | All shared types: `Token`, `StepResult`, `RunInfo`, `EngineEvent`, `EngineSnapshot`, etc. |
| `src/cli/` | yargs CLI with commands: `init`, `run`, `ls`, `show` |

### Public API (library consumers)

Exported from `src/core/index.ts`:
- `parseWorkflow(filePath)` — read and parse a workflow file (async)
- `parseWorkflowFromString(source, filePath?)` — parse an in-memory markdown string
- `validateWorkflow(workflow)` — structural validation
- `executeWorkflow(workflow, options)` — run with event callbacks
- `createRunManager(dir)` — manage run persistence

### Workflow File Format

Up to four Markdown sections:
1. `# Title` + description (optional) — top-level H1 + prose
2. `# Inputs` (optional) — declared parameters with types/defaults
3. `# Flow` — Mermaid flowchart defining graph topology
4. `# Steps` — named step definitions (fenced code = script; plain prose = agent prompt)

### Build Output

`tsup` produces two ESM entry points in `dist/`:
- `dist/core/index.js` — library export
- `dist/cli/index.js` — CLI binary (with shebang injected)
