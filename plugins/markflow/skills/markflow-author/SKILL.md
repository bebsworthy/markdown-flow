---
name: markflow-author
description: Author markflow workflow markdown files — the single-.md format with a Mermaid flowchart and named steps (bash/python/js scripts or agent prompts). Use this whenever the user wants to create, scaffold, extend, fix, or validate a markflow workflow; whenever they mention "markflow", "workflow.md", a `# Flow` / `# Steps` markdown section, or paste a Mermaid flowchart that looks like a pipeline. Also use when the user asks "how do I structure this as a markflow workflow", wants to convert a shell pipeline or prompt chain into markflow, or asks about markflow's templating (LOCAL/GLOBAL/STEPS), routing (RESULT sentinel), retries, or config blocks.
---

# Authoring markflow workflows

`markflow` runs a single Markdown file as a workflow. The file *is* the spec: an H1 title, an optional prose description, an optional ` ```config ` block, a `# Flow` section with one Mermaid flowchart, and a `# Steps` section with one `##` heading per node. Each step is either a fenced code block (script) or plain prose (agent prompt).

This skill helps you produce a **valid, idiomatic** workflow file. The engine is strict — undefined template references hard-fail, node IDs must match step headings exactly, retry edges must be paired — so get the shape right on the first pass and validate before handing it back.

## When to use this skill

Trigger on any of:

- User asks to create, scaffold, fix, extend, or review a markflow workflow.
- User pastes a Mermaid flowchart and asks to "turn this into a workflow" or similar.
- User mentions a `# Flow` / `# Steps` markdown pair, a `RESULT:` sentinel, `LOCAL` / `GLOBAL` / `STEPS`, or a `markflow` command.
- User is converting a shell pipeline, cron job, build script, or agent prompt chain into markflow.

If the user is *running* an existing workflow (not authoring one), don't use this skill — direct them to `markflow run`.

## Critical rules (read first)

1. **Input grammar is strict.** Name must be backtick-wrapped: `` - `TAG` (default: `value`): description ``. No type prefixes, no em-dashes. See `references/workflow-anatomy.md`.
2. **Exactly one start node.** Stadium shape `([...])` marks start in cyclic graphs. Loop targets are NOT start nodes — don't give them stadium shape.
3. **Loop targets need a labeled back-edge.** All-unlabeled incoming edges = fan-in merge = deadlock on iteration 2. Label at least one back-edge: `apply -->|loop| emit`.
4. **`MARKFLOW_RUNDIR` not `RUN_DIR`.** One word, no underscore. Silent failure if misspelled.
5. **Inputs are flat in Liquid.** `{{ city }}` not `{{ INPUTS.city }}`. The INPUTS namespace doesn't exist.

## The authoring loop

Work through these steps in order. Don't skip the interview — the engine's strictness punishes guessing.

### 1. Interview

Collect just enough to draft. Ask inline (one question per turn is fine if the user is terse):

- **What does the workflow do?** One-sentence purpose.
- **Inputs?** Key/value params the run needs (e.g. `repo`, `target_branch`). These become env vars for every step.
- **High-level steps?** Names + what each one *does*. You'll decide script-vs-agent per step.
- **Branching / loops / retries?** Any "if X then Y else Z", "retry up to 3 times", or "loop over a list" patterns.
- **Agent steps?** If any step is an LLM prompt, note which CLI (`claude`, `codex`, `gemini`) and whether it needs a specific model.

If the user is vague, propose a draft and iterate — don't over-interrogate.

### 2. Shape the graph first

Draft the Mermaid flowchart *before* writing step bodies. Getting the topology right up front prevents a rewrite later.

- Use short, lowercase, underscore-separated IDs (`lint`, `run_tests`, `emit_next`). They appear in logs and as `## <id>` headings.
- **Start nodes**: exactly one start node is allowed. In DAGs the engine auto-detects it (node with no incoming edges). In cyclic graphs, mark the *entry point* with stadium shape `([...])` — the node the workflow begins at. Loop targets are NOT start nodes; don't give them stadium shape.
- **Fan-out**: multiple unlabeled edges from a node run in parallel. **Fan-in**: a node with multiple incoming edges waits for *all* upstream to complete.
- **Routing**: use labeled edges (`A -->|pass| B`, `A -->|fail| C`). The step emits `RESULT: {"edge": "pass", ...}` to choose one. Exit code 0 auto-picks a non-`fail` edge; non-zero auto-picks `fail`.
- **Retries (graph-visible)**: `A -->|fail max:3| fix` plus `A -->|fail:max| abort`. `max:N` without `:max` halts on exhaustion — always pair them. See `references/mermaid-cheatsheet.md`.
- **Retries (in-place)**: for "try the same step again with backoff", use a step-level `retry:` in its ` ```config ` block instead — the graph stays clean. See `references/routing-and-config.md`.
- **forEach**: A thick edge `==>|each: KEY|` fans out dynamically — the engine spawns one token per array element. The body chain runs per item and converges at a collector. Configure `maxConcurrency` (0=unlimited, 1=serial, N=sliding window) and `onItemError` in the source step's `foreach:` config block. See `references/routing-and-config.md`.
- **Loops and fan-in**: A loop target with ALL unlabeled incoming edges is treated as a fan-in merge — it waits for all upstream tokens, causing deadlock on iteration 2. Fix by labeling the back-edge: `process -->|loop| emit`. See `references/mermaid-cheatsheet.md`.

### 3. Fill in step bodies

One `##` heading per node in the flow — **exact ID match, no extras, no missing ones**. The validator rejects both orphan steps and unreferenced nodes.

Pick a step type from the subsection content:

| Content | Type | When to use |
|---|---|---|
| ` ```bash `  / ` ```sh ` | bash script | Side effects, file ops, `gh`/`jq`/`curl`, anything deterministic |
| ` ```python ` | python3 script | Data transforms, libraries bash lacks |
| ` ```js ` / ` ```javascript ` | node script | Existing Node tooling |
| plain prose (no code block) | agent prompt | Classification, summarization, code generation |

Per-step config goes in an optional ` ```config ` block as the *first* block under the heading:

````markdown
## classify

```config
agent: claude
flags: [--model, haiku]
timeout: 2m
retry:
  max: 3
  delay: 10s
  backoff: exponential
```

Classify the issue body below into one label.
...
````

Full config reference: `references/routing-and-config.md`.

### 4. Wire the context

Steps communicate through three JSON surfaces (all injected as env vars; also available to agent prompts via Liquid templating):

- `STEPS` — read-only map of completed steps: `{ <id>: { edge, summary, local? } }`.
- `LOCAL` — this step's own accumulated state, survives across re-entries (loops).
- `GLOBAL` — workflow-wide shared state.

**Env vars injected into every step — use these exact names, no creative spellings**:

| Variable | Value |
|---|---|
| `MARKFLOW_RUNDIR` | run directory (note: **RUNDIR**, one word, no underscore between `RUN` and `DIR`) |
| `MARKFLOW_WORKDIR` | step cwd (per-run workspace) |
| `MARKFLOW_WORKSPACE` | persistent workspace path, if linked |
| `MARKFLOW_STEP` | current step ID |
| `MARKFLOW_PREV_STEP` / `MARKFLOW_PREV_EDGE` / `MARKFLOW_PREV_SUMMARY` | predecessor info |
| `STEPS`, `LOCAL`, `GLOBAL` | JSON strings — parse with `jq` in bash, `json.loads(os.environ[...])` in python |
| *(declared inputs)* | each `# Inputs` entry becomes a flat env var (e.g. `$city`, `$repo`) |

Typos here fail silently — `${MARKFLOW_RUN_DIR:-.}` will fall through to `.` every time because that variable doesn't exist. Copy the names exactly.

**Inputs in scripts vs agent prompts**: In bash/python/js steps, inputs are plain env vars — `$city`, `${city}`, `os.environ["city"]`. In agent prompts, inputs are **flat Liquid variables** — `{{ city }}`, not `{{ INPUTS.city }}`. There is no `INPUTS` namespace; the engine injects inputs at the top level of the Liquid context. Using `{{ INPUTS.* }}` will hard-fail rendering in strict mode.

> **Liquid is only rendered in agent step bodies.** Bash/python/js script bodies are passed to the interpreter verbatim — `{{ city }}` inside a `bash` block is a literal string, not a template. Use `$city` there.

Steps *publish* by emitting sentinel lines on stdout:

```
LOCAL:  {"cursor": 3}
GLOBAL: {"topic": "autumn leaves"}
RESULT: {"edge": "next", "summary": "picked issue #42"}
```

Rules that trip people up:

- `RESULT` must be the **last line** when emitted. Required for agent steps with ≥2 outgoing edges. For steps with a single outgoing edge, the engine routes automatically without it. Emitting RESULT is always valid and adds a log-visible summary.
- `LOCAL` / `GLOBAL` lines **shallow-merge** (later keys win). Don't nest `"local"` / `"global"` inside `RESULT`.
- Agent prompts are rendered through **Liquid in strict mode** before being sent — any `{{ GLOBAL.missing }}` hard-fails. If a variable might be absent, use `{{ value | default: "…" }}`.

Full templating reference (filters like `| list`, `| table`, `| json`, `| code`): `references/context-and-templating.md`.

### 5. Validate

**Always validate before calling the workflow done.** The engine's parser is strict and early errors save debugging time later.

Use `markflow init` against a throwaway workspace — it parses, links, and runs structural validation without executing any steps:

```bash
# If markflow is installed globally or in the project:
markflow init path/to/workflow.md -w /tmp/markflow-validate-$$

# Otherwise, via npx (no checkout needed):
npx -y markflow init path/to/workflow.md -w /tmp/markflow-validate-$$
```

Exit code 0 = valid. Any error output points to the exact problem (missing step, bad edge label, unpaired retry handler, bad config key). Fix and re-run.

> Not a real "run" — `init` only sets up the workspace and validates the file; it does not execute steps. Clean up `/tmp/markflow-validate-$$` afterward or leave it; it's harmless.

If `markflow` is not installed and `npx` is unavailable, do structural validation by inspection using `references/workflow-anatomy.md` as the checklist, and tell the user which tool to install to validate properly.

### 6. Hand off

Return:
- The workflow `.md` file path and a short explanation of the shape.
- The validation command output (or note that it passed).
- How to run it: `markflow run <file>` or `npx -y markflow run <file>`.

## Reference material

Load these on demand — don't front-load all of them.

- `references/workflow-anatomy.md` — full file format spec (sections, ordering, step types, errors). Read when unsure about structure.
- `references/mermaid-cheatsheet.md` — supported node shapes, edge types, labels, retry annotations, subgraphs. Read when drafting the flow.
- `references/context-and-templating.md` — env vars, sentinel protocol, Liquid filters, markdown filters. Read when wiring data between steps or writing agent prompts.
- `references/routing-and-config.md` — top-level config block, per-step config, agents/flags, timeouts, retry policies, forEach config. Read when adding retries, timeouts, forEach, or non-default agents.
- `references/workspace.md` — workspace initialization, `.env` scaffolding, input resolution priority, secret masking. Read when explaining how workspaces and inputs persist.

## Examples

Six reference workflows — copy the shape, not the literal content.

- `examples/01-linear.md` — minimal three-step pipeline with one bash script, one agent step, one render step. Start here.
- `examples/02-fan-out-fan-in.md` — parallel fan-out across independent steps then a join/fan-in. Uses `STEPS.<id>.summary` to aggregate.
- `examples/03-sequential-foreach-agent.md` — sequential forEach (`maxConcurrency: 1`) with an agent step using Liquid templating. The recommended pattern for "process a list with an LLM".

Open an example with `Read` when a user's request matches its shape.

- `examples/04-foreach.md` — forEach with `maxConcurrency` sliding window and `onItemError: continue`. Source emits items, body processes with retry, collector aggregates.
- `examples/05-inputs-and-branching.md` — declared inputs used in bash (`$NAME`) and agent prompts (`{{ NAME }}`), with conditional edge routing.
- `examples/06-retry-and-timeout.md` — edge-level retry (`fail max:3` + `fail:max` exhaustion handler), per-step timeout, self-edge retry loop.


## House style

These aren't rules, they're what works:

- Put **why** in the top-of-file description (between H1 and `# Flow`) — the parser ignores it, humans read it. Agent step bodies are *also* documentation.
- Keep step bodies focused. If a bash step is growing past ~40 lines, consider splitting it or moving logic into a helper script called from the step.
- Prefer publishing data via `GLOBAL:` over stuffing everything through `RESULT.summary`. `RESULT` is for routing + a one-liner.
- For list-processing loops, prefer **forEach with `maxConcurrency: 1`** (see `examples/04-foreach.md`) over the manual emitter pattern. forEach handles cursor tracking, result collection, and error policies automatically — no back-edges or LOCAL cursor gymnastics needed.
- When a step has 2+ outgoing labeled edges, the engine appends a hint to agent prompts listing the valid edges. You don't need to duplicate it in your prompt.
- `flags:` in `config` is for *extra* agent args only — never include the non-interactive switch (`-p`, `exec -`); the engine auto-prepends it.

## Common mistakes to check before declaring done

- [ ] Every node in the flow has a `## <id>` subsection, and every `##` subsection is a node in the flow.
- [ ] Node IDs in Mermaid exactly match step headings (case-sensitive, no stray whitespace).
- [ ] Every labeled edge with `max:N` has a paired `label:max` exhaustion edge.
- [ ] Cyclic graphs mark their entry with stadium shape: `entry([…])`.
- [ ] Agent prompts don't reference undefined Liquid variables — strict mode will reject them.
- [ ] Env var names are spelled correctly: `MARKFLOW_RUNDIR` (one word "RUNDIR"), `MARKFLOW_WORKDIR`, `STEPS`, `LOCAL`, `GLOBAL`. No `MARKFLOW_RUN_DIR`.
- [ ] Inputs are referenced as `$name` in scripts and `{{ name }}` in agent prompts — never `{{ INPUTS.name }}` (that namespace doesn't exist).
- [ ] No Liquid `{{ }}` inside bash/python/js bodies — script bodies are not rendered.
- [ ] No `local` or `global` keys inside `RESULT` JSON.
- [ ] `config` block (top-level *or* per-step) only uses documented keys.
- [ ] forEach thick edges (`==>|each: KEY|`) have a collector node downstream.
- [ ] Loop targets have at least one labeled back-edge (prevents fan-in deadlock).
- [ ] Ran `markflow init <file> -w /tmp/...` and got exit 0.
