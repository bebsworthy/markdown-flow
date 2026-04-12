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

### Execution Model

The engine uses a **token-based model**: tokens flow through graph nodes with states (pending → running → complete/skipped).

- **Fan-out:** Multiple unlabeled edges from a node execute in parallel
- **Fan-in:** Nodes with multiple incoming edges wait for all upstream to complete
- **Routing:** Exit code 0 → success path, non-zero → failure path; agents can emit `RESULT: {"edge": "...", "summary": "..."}` for explicit routing
- **Retries:** `fail max:N` edge annotations retry up to N times; `fail:max` handles exhaustion

### Key Modules

| Module | Responsibility |
|---|---|
| `src/core/parser/` | Extract sections from Markdown, parse Mermaid flowchart topology |
| `src/core/engine.ts` | `WorkflowEngine` class — token-based execution orchestration |
| `src/core/router.ts` | Edge resolution and retry state accounting |
| `src/core/validator.ts` | Structural validation (node/step correspondence, edge labels, retry completeness) |
| `src/core/runner/` | `runStep()` dispatcher → `script.ts` (bash/python/js) or `agent.ts` (prose prompts) |
| `src/core/run-manager.ts` | Persist run history as JSONL logs in run directories |
| `src/core/types.ts` | All shared types: `Token`, `StepResult`, `RunInfo`, `EngineEvent`, etc. |
| `src/cli/` | yargs CLI with three commands: `start`, `ls`, `run` |

### Public API (library consumers)

Exported from `src/core/index.ts`:
- `parseWorkflow(markdown)` — parse MD into workflow graph
- `validateWorkflow(workflow)` — structural validation
- `executeWorkflow(workflow, options)` — run with event callbacks
- `createRunManager(dir)` — manage run persistence

### Workflow File Format

Three Markdown sections:
1. `# Flow` — Mermaid flowchart defining the graph topology
2. `# Steps` — Named step definitions (fenced code = script; plain prose = agent prompt)
3. Optionally a top-level `# Title` and description

### Build Output

`tsup` produces two ESM entry points in `dist/`:
- `dist/core/index.js` — library export
- `dist/cli/index.js` — CLI binary (with shebang injected)
