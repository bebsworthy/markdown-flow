# Configuration

How workflow-wide and per-step defaults are declared, merged, and resolved.

## Precedence

Defaults can be set at four layers, in ascending precedence:

1. **Top-level ` ```config ` block** inside the workflow `.md` — inline defaults that keep the file self-contained.
2. **`.workflow.json` sidecar** next to the workflow `.md`.
3. **Per-step ` ```config ` block** at the top of a step — overrides or appends for that step only.
4. **Programmatic `options.config`** passed to `executeWorkflow` — overrides all three.

If both a top-level block and a `.workflow.json` are present, the engine prints a warning at start — the JSON wins.

## Top-level config block

````markdown
# My Workflow

```config
agent: claude
flags:
  - --model
  - haiku
parallel: true
max_retries_default: 3
timeout_default: 30m
```

# Flow
…
````

## `.workflow.json` sidecar

```json
{
  "agent": "claude",
  "agent_flags": ["--model", "haiku"],
  "max_retries_default": 3,
  "timeout_default": "30m",
  "parallel": true
}
```

## Non-interactive agent invocation is engine-owned

The assembled prompt is piped to the agent's stdin; argv contains `agent_flags` (or `flags:`) prefixed by the agent's non-interactive invocation. markflow owns that prefix — `-p` for `claude` and `gemini`, `exec -` for `codex` — and prepends it automatically. `flags` is for *extra* args (model selection, verbosity, etc.); if you list a baseline flag again it is silently deduped with a warning. For agents markflow doesn't know, `flags` is passed through verbatim.

## Per-step overrides

````markdown
## analyze-ticket

```config
agent: gemini
flags:
  - --model
  - gemini-2.0-flash
```

You are a ticket analyst. …
````

Per-step `flags` **append** to the workflow-level list — the per-step block doesn't replace it. Use `agent:` to swap the binary entirely.

### Per-step timeouts

The per-step `config` block also supports `timeout: <duration>` (e.g. `30s`, `5m`, `1h30m`). This caps a single execution attempt; retries each get a fresh window. When unset, the step inherits `timeout_default` from the workflow-level config. On timeout, the step routes via its `fail` edge with exit code 124. Works for both script and agent steps.

## Step retry policies

A step can declare an intrinsic retry policy in its `config` block. On failure the step re-executes in place; only after the retry budget is exhausted is the `fail` edge traversed.

````markdown
## api-call

```config
retry:
  max: 3
  delay: 10s
  backoff: exponential   # fixed | linear | exponential (default: fixed)
  maxDelay: 5m
  jitter: 0.3            # 0..1 fraction (default: 0)
```

Call the upstream API and return the payload.
````

With this, the graph needs only a plain `fail` branch — no self-loop:

```
api-call --> next
api-call -->|fail| error-handler
```

### Interaction with legacy self-loop retries

The legacy self-loop form (`A -->|fail max:3| A` plus `A -->|fail:max| handler`) still works. When both a step-level `retry` policy and an edge-level `fail max:N` are specified on the same node, the step-level `retry` policy wins and the validator emits a warning. See [`routing-and-retries.md`](routing-and-retries.md) for full retry semantics.

## forEach concurrency config

Steps that source a forEach fan-out (thick edge `==>|each: KEY|`) accept a `foreach:` block in their per-step config:

````markdown
## produce

```config
foreach:
  maxConcurrency: 3
  onItemError: continue
```

```bash
# emit the items array
echo 'LOCAL: {"items": [1, 2, 3, 4, 5]}'
echo 'RESULT: {"edge": "next", "summary": "produced 5 items"}'
```
````

| Key | Type | Default | Description |
|---|---|---|---|
| `maxConcurrency` | non-negative integer | `0` (unlimited) | Max item tokens executing concurrently. `1` = serial. |
| `onItemError` | `fail-fast` \| `continue` | `fail-fast` | What happens when an item fails. |

When `maxConcurrency` is set, the engine uses a sliding window: it spawns the initial batch of tokens up to the limit, then refills one slot each time an item completes. Result ordering is always by original array index.

See [`routing-and-retries.md`](routing-and-retries.md) for full forEach routing semantics.

## See also

- [`templating-and-context.md`](templating-and-context.md) — how workflow inputs flow into prompts and scripts.
- [`routing-and-retries.md`](routing-and-retries.md) — edge resolution, retry budgets, forEach, timeout routing.
