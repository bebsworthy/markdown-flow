# Templating and Context Surfaces

How values flow into step prompts and scripts, and how steps publish state back
to the rest of the workflow.

## Variable templating in agent prompts

Agent prompts are rendered with [LiquidJS](https://liquidjs.com/) in **strict mode**. Use `{{ VAR }}` to interpolate, `{% … %}` for control flow, and `|` for filters. Undefined variables cause the run to fail with a descriptive error.

```markdown
## review

You are a code reviewer. The repository is at {{ MARKFLOW_WORKDIR }}.
The previous step reported: {{ MARKFLOW_PREV_SUMMARY }}
Review the code for {{ REVIEW_CRITERIA }}.
```

### Flat variables

- Any declared workflow input (e.g. `{{ DEPLOY_TARGET }}`)
- `{{ MARKFLOW_STEP }}` — current step name
- `{{ MARKFLOW_PREV_STEP }}`, `{{ MARKFLOW_PREV_EDGE }}`, `{{ MARKFLOW_PREV_SUMMARY }}` — context from the previous step
- `{{ MARKFLOW_WORKDIR }}` — per-run working directory (cwd for scripts and agents)
- `{{ MARKFLOW_WORKSPACE }}` — persistent workspace directory (contains `.env` and `runs/`)
- `{{ MARKFLOW_RUNDIR }}` — run log directory

### Structured namespaces

- `{{ GLOBAL.* }}` — workflow-wide context accumulated across steps
- `{{ STEPS.<id>.edge }}`, `{{ STEPS.<id>.summary }}`, `{{ STEPS.<id>.local.* }}` — results from prior steps

To include literal `{{` or `{%` in a prompt, wrap the region in `{% raw %}…{% endraw %}`.

### Filter catalog

Markdown-oriented filters are registered for turning structured data into prompt-ready markdown:

- `json`, `yaml` — serialize a value. Both accept an optional comma-separated field list, e.g. `{{ issue | json: "number,title" }}`.
- `list`, `table` — render arrays/objects as markdown lists or tables.
- `code` — wrap in a fenced block.
- `heading`, `quote`, `indent` — structural formatters.
- `pluck`, `keys`, `values` — array/object shaping.

## Context surfaces (`LOCAL` / `GLOBAL` / `STEPS`)

Every step can read and emit two JSON-shaped context surfaces:

- **`LOCAL`** — step-private. Only the same step sees it on re-entry (the cursor memory used by loops/emitters).
- **`GLOBAL`** — workflow-wide. All subsequent steps read it.
- **`STEPS`** — read-only map of prior steps' `{ edge, summary, local }`.

### Script contract (stdin → env, stdout → sentinels)

Scripts receive `$LOCAL`, `$GLOBAL`, and `$STEPS` as JSON-string env vars, and emit updates as stdout sentinels:

```
LOCAL:  {"cursor": 3}
GLOBAL: {"item": {...}}
RESULT: {"edge": "next", "summary": "..."}
```

Multiple `LOCAL:` / `GLOBAL:` lines shallow-merge (later keys win).

### Agent contract

Agent steps receive the same values rendered into the prompt via `{{ LOCAL }}` / `{{ GLOBAL }}` / `{{ STEPS }}` template variables, and emit updates through the same stdout sentinel protocol as scripts.

### Relation to the engine

These surfaces are unrelated to the engine's internal token-state machine — they are application-level state the workflow author manages. The engine only snapshots `global:update` events in the run log; `LOCAL` is per-step-instance and recovered by looking up the most recent completed `StepResult` for the same node. See [`event-sourced-run-log.md`](event-sourced-run-log.md) for the event schema.

## See also

- [`configuration.md`](configuration.md) — declaring inputs and layered defaults.
- [`routing-and-retries.md`](routing-and-retries.md) — how `RESULT:`'s `edge` feeds into routing.
