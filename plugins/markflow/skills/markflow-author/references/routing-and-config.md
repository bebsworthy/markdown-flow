# Routing, Config, Timeouts, Retries

How steps pick an outgoing edge, how retries work, and what goes in a `config` block (top-level or per-step).

## Routing — how the engine picks an outgoing edge

After a step completes the engine looks at:

1. **Explicit `RESULT: {"edge": "label"}` on stdout.** Wins if present and the label matches an outgoing edge. Required for agent steps.
2. **Exit code (script steps only).**
   - `0` → pick any non-`fail` edge (if multiple unlabeled ones → fan-out, all run).
   - Non-zero → pick the `fail` edge if one exists; otherwise the workflow halts.
   - `124` → timeout (engine sets this); routes via `fail` if present.
3. No matching edge → halt with an error.

If a step has exactly one outgoing unlabeled edge, you don't need to emit `RESULT` at all; exit 0 sends the token through.

## Graph-visible retries (edge-level)

On a labeled edge, `max:N` caps how many times the engine will follow that edge from the same source node. A paired `label:max` edge absorbs the exhaustion.

```mermaid
test -->|fail max:3| fix
test -->|fail:max| abort
fix --> test
```

- Budget resets per run, not per token.
- Always pair `max:N` with a `:max` handler — without it, exhaustion halts the workflow with an error.
- `label:max` without a `max:N` partner is a parse error.

Use graph-visible retries when the retry involves routing *somewhere else* (like a `fix` step before retrying `test`). They're visible in run visualizations.

## In-place retries (step-level `retry:` policy)

For "try this same step again with backoff, no graph branching", put a `retry:` block inside the step's ` ```config `:

````markdown
## flaky_api_call

```config
retry:
  max: 5
  delay: 2s
  backoff: exponential
  jitter: 0.3
```

```bash
curl -fsSL https://api.example.com/data > out.json
```
````

Keys:

| Key | Type | Meaning |
|---|---|---|
| `max` | number | Max attempts (including the first) |
| `delay` | duration | Base delay between attempts: `500ms`, `2s`, `1m`, `30m` |
| `backoff` | `fixed` \| `linear` \| `exponential` | Delay growth strategy |
| `jitter` | 0..1 | Randomization factor applied to delay |

The step is re-invoked with `LOCAL` preserved across attempts (so you can track attempt count) but `MARKFLOW_PREV_*` unchanged. Retries happen only on failure (non-zero exit or `RESULT.edge == "fail"`).

**Step-level retry wins if both are present** (edge-level + step-level on the same failure).

## Timeouts

Per-step timeout goes in the step's `config`:

```config
timeout: 30s
```

A workflow-wide default:

```config
timeout_default: 2m
```

Units: `ms`, `s`, `m`, `h`. On timeout the step is killed, exit code becomes `124`, routing falls back to `fail`.

## Top-level `config` block

Sits between the H1 (or description) and `# Flow`. YAML body.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `agent` | string | `claude` | Default agent CLI for agent steps |
| `flags` | list of strings | `[]` | Extra args passed to the agent CLI |
| `parallel` | bool | `true` | Permit concurrent token execution on fan-out |
| `max_retries_default` | number | unset | Default `retry.max` for step-level retries |
| `timeout_default` | duration | unset | Default per-step timeout |

Precedence (lowest → highest): built-in defaults < this block < sibling `.workflow.json` < programmatic `options.config`. If both inline and sibling are present, the JSON sidecar wins with a warning at start.

### `flags` gotcha

`flags` is for *extra* args only. The engine auto-prepends the non-interactive switch based on the agent basename:

- `claude`, `gemini` → `-p`
- `codex` → `exec -`

Don't include those in `flags`; duplicates are deduped with a warning.

```config
agent: claude
flags:
  - --model
  - haiku
```

produces `claude -p --model haiku` at execution time.

## Per-step `config` block

The *first* fenced block under a `##` heading may be ` ```config `. Recognized keys:

| Key | Type | Meaning |
|---|---|---|
| `agent` | string | Override the workflow-level agent for this step |
| `flags` | list | Extra args for this step only (merged with workflow-level) |
| `timeout` | duration | Override `timeout_default` for this step |
| `retry` | object | Step-level retry policy (see above) |
| `approve` | object | Human-approval gate before the step runs (advanced) |

Example combining several:

````markdown
## classify

```config
agent: claude
flags: [--model, haiku]
timeout: 45s
retry:
  max: 3
  delay: 5s
  backoff: exponential
```

Classify the ticket body into one label.
{{ GLOBAL.item.body | default: "(no body)" }}
````

## Picking the right retry mechanism

| Situation | Use |
|---|---|
| Flaky network call, just retry the same thing | Step-level `retry:` |
| Test fails, run a `fix` step then retry test | Edge-level `max:N` + `:max` |
| Rate-limited API, exponential backoff | Step-level `retry:` with `backoff: exponential` |
| Agent might hallucinate; want it to re-prompt with same context | Step-level `retry:` |
| Agent hallucinates; want a different handler step in between | Edge-level |

## Approval gates

A step may pause for human approval before running by including `approve:` in its `config`. The run enters a `pending` state; the operator inspects and resumes with `markflow approve <run> <node> <choice>`. See the CLI `markflow pending --help` and `markflow approve --help` for current options — this is an evolving surface.
