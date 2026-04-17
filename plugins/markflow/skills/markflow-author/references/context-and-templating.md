# Context and Templating

Steps share data through three namespaces: `LOCAL`, `GLOBAL`, `STEPS`. They're injected as env vars (JSON strings) for script steps and rendered through Liquid templating for agent steps.

## The three context surfaces

| Namespace | Scope | Populated by |
|---|---|---|
| `LOCAL`  | This step only, persists across re-entries (loops) | This step's own `LOCAL:` sentinel lines |
| `GLOBAL` | Whole workflow, any step reads | Any step's `GLOBAL:` sentinel lines |
| `STEPS`  | Read-only map of completed steps | Engine; shape `{ <id>: { edge, summary, local? } }` |

**When to pick which:**

- Data one step accumulates for *itself* across iterations (a cursor, a retry counter) → `LOCAL`.
- Data one step produces for *downstream consumers* it doesn't need to know about → `GLOBAL`.
- Data one step needs from a *specific, named* predecessor → `STEPS.<id>.local.<key>` or `STEPS.<id>.summary`.

Prefer `GLOBAL` over stuffing things into `RESULT.summary`. Summaries are for humans reading logs.

## Environment variables injected into every step

| Variable | Value |
|---|---|
| `MARKFLOW_RUNDIR` | Absolute path to the run directory |
| `MARKFLOW_WORKDIR` | Absolute path to the per-run working directory (the step's cwd) |
| `MARKFLOW_WORKSPACE` | Absolute path to the persistent workspace, if one is linked |
| `MARKFLOW_STEP` | ID of the current step |
| `MARKFLOW_PREV_STEP` | ID of the predecessor step |
| `MARKFLOW_PREV_EDGE` | Edge label that routed here |
| `MARKFLOW_PREV_SUMMARY` | One-liner summary from the predecessor's `RESULT` |
| `STEPS` | JSON string: `{ <id>: { edge, summary, local? } }` |
| `LOCAL` | JSON string: this step's accumulated local state (`{}` on first entry) |
| `GLOBAL` | JSON string: current workflow-wide global context |

Declared workflow inputs are also injected as env vars (e.g., `repo`, `target_branch`).

## Sentinel protocol (how steps publish)

Steps write these on stdout to communicate back to the engine:

```
LOCAL:  { "cursor": 3, "seen": 12 }
GLOBAL: { "topic": "autumn leaves" }
RESULT: { "edge": "next", "summary": "picked issue #42" }
```

Rules:

- **One sentinel per line.** The marker must be at the start of the line.
- `LOCAL:` and `GLOBAL:` may appear **zero or more times** anywhere in output. Multiple occurrences **shallow-merge** — later keys overwrite earlier.
- `RESULT:` must be the **last line** when emitted. For agent steps it's required. For script steps it's optional; absent → route by exit code.
- Do **not** nest `"local"` or `"global"` keys inside `RESULT`. Those are separate channels.
- Lines that don't start with a sentinel are normal stdout and tee'd to the step's output sidecar.

## Liquid templating in agent prompts

Agent step bodies are rendered with [LiquidJS](https://liquidjs.com/) in **strict mode** before being sent to the agent. Any unresolved variable or dotted path hard-fails the step with a clear error.

### Variable forms

| Form | Meaning |
|---|---|
| `{{ NAME }}` | Flat variable — workflow inputs, `MARKFLOW_*` env vars |
| `{{ GLOBAL.path.to.key }}` | Dotted access into the workflow-wide context |
| `{{ STEPS.<id>.local.<key> }}` | Local-state value from a named completed step |
| `{{ STEPS.<id>.summary }}` / `{{ STEPS.<id>.edge }}` | Predecessor's `RESULT` summary / edge |
| `{% for x in GLOBAL.items %}...{% endfor %}` | Iterate arrays |
| `{% if COND %}...{% endif %}` | Conditional |
| `{{ value \| default: "..." }}` | Guard against missing values |
| `{% raw %}{{ VAR }}{% endraw %}` | Literal — no substitution |

### Handling optional values

Strict mode means this fails if `body` is missing:

```
{{ GLOBAL.item.body }}
```

Use `default` or guard with `if`:

```
{{ GLOBAL.item.body | default: "(no body)" }}
```

### Trim markers

Liquid preserves newlines around tags. When iterating inline, use `{%-` / `-%}` (or `{{-` / `-}}`) to avoid stray blank lines:

```
{%- for label in GLOBAL.labels %}
- {{ label.name }}: {{ label.description }}
{%- endfor %}
```

## Custom markdown filters

markflow registers extra Liquid filters tuned for producing markdown inside agent prompts:

| Filter | Example | Output |
|---|---|---|
| `json` | `{{ obj \| json }}` | Pretty JSON, 2-space indent |
| `json: "a,b"` | `{{ obj \| json: "name,age" }}` | JSON filtered to listed fields (per-element for arrays) |
| `yaml` / `yaml: "a,b"` | `{{ obj \| yaml }}` | YAML, with optional field filter |
| `list` | `{{ xs \| list: "name,description" }}` | Bullet list — first field becomes `` `code` `` header, remaining fields join with ` — ` |
| `table` | `{{ xs \| table: "name,age" }}` | Markdown table; nested object cells render as JSON; `\|` is escaped |
| `code` | `{{ text \| code: "json" }}` | Fenced code block; language is optional |
| `heading: N` | `{{ title \| heading: 2 }}` | Prefixes N `#` characters (clamped 1–6) |
| `quote` | `{{ text \| quote }}` | Prefixes each line with `> ` |
| `indent: N` | `{{ text \| indent: 4 }}` | Left-pads each line with N spaces |
| `pluck: "field"` | `{{ xs \| pluck: "name" \| join: ", " }}` | Extracts one field from each object |
| `keys` / `values` | `{{ obj \| keys \| join: "," }}` | Object introspection |

Filters compose: `{{ obj | json | code: "json" }}` produces a JSON code block.

## Trailing protocol block (agent steps)

After rendering your prompt the engine appends a fixed block explaining the sentinel protocol and — when the step has 2+ outgoing edges — the list of valid edge labels. You don't need to duplicate this in your prompt, but you may want to remind the agent what to emit, e.g.:

```
Emit the label as LOCAL so the next step can pick it up:
LOCAL: {"label": "<choice>"}
```

## Examples

### Script step publishing for downstream
```bash
TOPIC="autumn leaves"
echo "Topic: $TOPIC"
echo "GLOBAL: $(jq -nc --arg t "$TOPIC" '{topic:$t}')"
```

### Script step reading predecessor output
```bash
TOPIC=$(jq -r '.topic' <<< "$GLOBAL")
HAIKU=$(jq -r '.compose.local.haiku // "(no haiku)"' <<< "$STEPS")
printf '— %s —\n%s\n' "$TOPIC" "$HAIKU"
```

### Script step maintaining loop cursor in LOCAL
```bash
CURSOR=$(jq -r '.cursor // -1' <<< "$LOCAL")
NEXT=$((CURSOR + 1))
# ...work...
echo "LOCAL: $(jo cursor=$NEXT)"
```

### Agent step reading GLOBAL and emitting LOCAL + RESULT
```
Classify this ticket into one of the labels below.

**Title:** {{ GLOBAL.item.title }}
**Body:** {{ GLOBAL.item.body | default: "(no body)" }}

Labels:
{{ GLOBAL.labels | list: "name,description" }}

Emit your choice on a LOCAL line so the next step can pick it up:
LOCAL: {"label": "<choice>"}
```
