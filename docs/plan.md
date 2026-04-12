# Markflow Implementation Plan

## Context

The repo contains only `spec.md` — a detailed workflow engine specification. The goal is to implement this as a TypeScript project called **markflow** that can be used both as a CLI tool (`npx markflow start <file>`) and as a library. Workflow history must be logged as JSONL (deviation from spec's `context.json`).

---

## Project Structure

```
src/
  core/                        # Library (public API)
    index.ts                   # Barrel exports
    types.ts                   # All shared types/interfaces
    parser/
      index.ts                 # Orchestrates parsing: md → mermaid → steps
      markdown.ts              # Extracts H1 name, # Flow mermaid block, # Steps sections
      mermaid.ts               # Adapter: @mermaid-js/parser AST → FlowGraph + annotation extraction
      steps.ts                 # Determines step type (script vs agent) from ## content
    validator.ts               # 5 structural validation rules from spec
    graph.ts                   # Adjacency queries: start nodes, fan-out, merge detection
    engine.ts                  # Token-based execution engine with parallel support
    router.ts                  # Edge resolution, exit-code mapping, retry accounting
    runner/
      index.ts                 # Factory: delegates to script or agent runner
      script.ts                # Spawns bash/python/node subprocesses
      agent.ts                 # Assembles prompt, invokes agent CLI, parses RESULT:
    run-manager.ts             # Creates run dirs, lists runs, reads run status
    context-logger.ts          # JSONL append-only logging to context.jsonl
    config.ts                  # Reads .workflow.json, merges with defaults
  cli/
    index.ts                   # #!/usr/bin/env node, yargs setup
    commands/
      start.ts                 # markflow start <file> [--dry-run]
      ls.ts                    # markflow ls
      run.ts                   # markflow run <id>
test/
  fixtures/                    # Sample .md workflow files for testing
    linear.md
    branch.md
    retry.md
    parallel.md
    cycle.md
    full-ci.md
    invalid/                   # Files with known validation errors
  core/
    parser/
      mermaid.test.ts
      markdown.test.ts
      steps.test.ts
    validator.test.ts
    graph.test.ts
    router.test.ts
    context-logger.test.ts
    engine.test.ts
```

---

## Tooling

| Tool | Choice | Rationale |
|------|--------|-----------|
| Build | **tsup** | Zero-config, esbuild-based, handles bin shebang, outputs ESM + .d.ts |
| Dev runner | **tsx** | Runs TS directly during development |
| Test | **vitest** | Native ESM, TS-first, fast |
| Markdown parse | **unified + remark-parse** | Standard AST library, avoids custom MD parser |
| Mermaid parse | **@mermaid-js/parser** | Official parser, structured AST, no rendering/D3/jsdom deps |
| CLI framework | **yargs** | Mature, subcommand support |
| Formatting | **chalk** | Terminal colors for CLI output |

---

## Implementation Phases

### Phase 1: Project Scaffolding
- `package.json` (name: markflow, bin config, ESM, scripts)
- `tsconfig.json` (strict, ES2022, bundler resolution)
- `tsup.config.ts` (dual entry: core + cli)
- `.gitignore` (node_modules, dist, runs)
- `src/core/types.ts` — all interfaces upfront

### Phase 2: Parser + Validator (testable in isolation)
1. `parser/mermaid.ts` — adapter over `@mermaid-js/parser`
   - Parses flowchart via official parser, maps AST nodes/edges into our `FlowGraph` types
   - Post-processes edge labels to extract annotations: `max:N`, `:max`
2. `parser/markdown.ts` — uses remark-parse to extract 3 sections (name, flow mermaid block, steps)
3. `parser/steps.ts` — determines type from content (code block → script with lang, prose → agent)
4. `parser/index.ts` — orchestrates: `parseWorkflow(filePath) → WorkflowDefinition`
5. `validator.ts` — 5 rules: node-step matching, orphan steps (warn), retry handler pairs, edge label uniqueness, supported languages
6. `graph.ts` — adjacency helpers: `getOutgoingEdges`, `getStartNodes`, `isMergeNode`, `getFanOutTargets`

### Phase 3: Execution Engine
7. `config.ts` — load `.workflow.json`, merge with defaults
8. `context-logger.ts` — append `StepResult` as JSONL to `context.jsonl`
9. `run-manager.ts` — create `runs/<iso-timestamp>/workspace/`, list runs, get run info
10. `runner/script.ts` — spawn subprocess, capture stdout/stderr/exit code, parse optional `RESULT:` line
11. `runner/agent.ts` — assemble prompt with workflow context + task + result instruction, invoke agent CLI
12. `router.ts` — edge resolution (single edge → follow; multi → match label; exit code mapping for scripts), retry counters with `max:N` / `:max` handling
13. `engine.ts` — token-based orchestrator:
    - Find start nodes, create initial tokens
    - Main loop: find ready tokens → execute → route → create new tokens
    - Parallel: launch ready tokens concurrently with `Promise.all` when `config.parallel`
    - Merge nodes: wait for all upstream tokens to be `complete` or `skipped`
    - Cycles: increment token `generation` on revisit
    - Emit typed `EngineEvent` objects via callback (not direct stdout)

### Phase 4: CLI
14. `cli/commands/start.ts` — parse → validate (print errors/warnings) → execute (with live event output). `--dry-run` for lint-only.
15. `cli/commands/ls.ts` — list runs as formatted table
16. `cli/commands/run.ts` — show detailed run info from JSONL
17. `cli/index.ts` — yargs wiring

---

## Key Design Decisions

1. **JSONL not JSON** for run history — append-only, crash-safe, streamable. File: `context.jsonl`
2. **`@mermaid-js/parser`** for Mermaid parsing — official parser, structured AST, no rendering deps. Our adapter just maps AST → `FlowGraph` and extracts annotations from labels
3. **Token model** for execution — supports cycles via `generation` counter; merge nodes wait for current generation only
4. **Event callback** for engine observability — `onEvent: (event: EngineEvent) => void` — CLI formats for humans, library consumers do whatever they want
5. **Script materialization** — write step code to temp file before execution (debuggable, works with all interpreters)
6. **Environment variables** injected into script steps: `MARKFLOW_STEP`, `MARKFLOW_RUNDIR`, `MARKFLOW_WORKDIR`, `MARKFLOW_PREV_STEP`, `MARKFLOW_PREV_EDGE`, `MARKFLOW_PREV_SUMMARY`

---

## CLI Commands

```
markflow start <file> [--dry-run] [--no-parallel] [--agent <cli>] [--runs-dir <path>]
markflow ls [--runs-dir <path>] [--json]
markflow run <id> [--runs-dir <path>] [--json]
```

`--dry-run` on `start` = parse + validate only (the "linting" feature).

---

## Verification

1. **Unit tests**: Run `npm test` — parser, validator, graph, router, context-logger all have dedicated test files
2. **Integration test**: Create `test/fixtures/full-ci.md` (the spec's complete example), run it with mock scripts that echo + exit, verify `context.jsonl` contains correct step sequence
3. **CLI smoke test**: `npx tsx src/cli/index.ts start test/fixtures/linear.md` — should parse, validate, execute, and print run ID
4. **Lint-only test**: `npx tsx src/cli/index.ts start test/fixtures/invalid/missing-step.md` — should print validation errors and exit 1
5. **Run listing**: After a successful run, `npx tsx src/cli/index.ts ls` should show it; `npx tsx src/cli/index.ts run <id>` should show step details
