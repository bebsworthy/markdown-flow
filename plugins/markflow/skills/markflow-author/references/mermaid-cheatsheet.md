# Mermaid Cheatsheet for markflow

markflow parses a subset of Mermaid's flowchart grammar. Everything here is supported; anything not here probably isn't.

## Diagram header

```mermaid
flowchart TD
```

- `flowchart` or the alias `graph`. Nothing else.
- Direction (`TD`, `LR`, `TB`, `BT`, `RL`) is parsed but ignored by the executor — purely for display.

## Node IDs and labels

A node ID is a plain identifier. Node shape is optional and affects display only (**except** stadium, which marks start nodes in cyclic graphs — see below).

| Syntax | Shape | Notes |
|---|---|---|
| `A` | default rectangle | Most common |
| `A[Label]` | rectangle | Explicit label |
| `A(Label)` | rounded | |
| `A([Label])` | stadium | **Marks a start node** in cyclic graphs |
| `A{Label}` | diamond | |
| `A((Label))` | circle | |
| `A(((Label)))` | double circle | |
| `A[(Label)]` | cylinder | |
| `A[[Label]]` | subroutine | |
| `A{{Label}}` | hexagon | |
| `A[/Label/]`, `A[\Label\]`, `A[/Label\]`, `A[\Label/]` | parallelogram / trapezoid variants | |
| `A>Label]` | asymmetric | |

Multi-word labels must be quoted: `A["Fetch the thing"]`. Only the first occurrence of a node needs its shape — later references can use the bare ID.

## Edges

| Syntax | Meaning |
|---|---|
| `A --> B` | Normal arrow |
| `A --- B` | Open link (no arrow) |
| `A -.-> B` | Dotted arrow |
| `A ==> B` | Thick arrow |
| `A -->|label| B` | Labeled arrow |
| `A -->|label max:N| B` | Labeled edge with retry budget |
| `A -->|label:max| B` | Exhaustion handler edge (paired with `max:N`) |

### Edge labels and routing

- An edge label is an **identifier**. Steps choose an outgoing edge by emitting `RESULT: {"edge": "label"}`.
- Unlabeled edges from a node with multiple outgoing unlabeled edges → **fan-out in parallel**.
- Conventional labels: `pass` / `fail`, `next` / `done`, `labeled` / `unlabeled`, etc. Pick clear names; they show up in logs.
- Non-zero exit code auto-routes to the `fail` edge if one exists; exit 0 auto-routes to a non-`fail` edge.

### Retry annotations

Two edges work together:

```
A -->|fail max:3| B
A -->|fail:max| C
```

- `max:3`: engine may follow this edge up to 3 times on repeated `fail` routes from `A`.
- `fail:max`: followed once the budget is exhausted.
- **Pair them always.** `max:N` with no `:max` halts the workflow on exhaustion. `:max` with no `max:N` is a parse error.
- For "re-try the same step in place" with backoff/jitter (no graph visibility), use the step-level `retry:` policy in a ` ```config ` block instead — see `routing-and-config.md`.

## Start nodes

**Exactly one start node is allowed.** The engine determines it two ways:

1. **DAGs (no cycles):** Auto-detected as the node with no incoming edges.
2. **Cyclic graphs (loops):** Mark the workflow's *entry point* with **stadium shape** — `A([Label])`. Once any node carries stadium shape, the "no incoming edges" fallback is disabled and stadium nodes become the complete start set.

```mermaid
flowchart TD
  emit([Emit next item])
  emit -->|next| process
  process -->|loop| emit
  emit -->|done| finalize
```

**Important:** The stadium shape marks where the workflow *begins*, NOT the loop target. If your workflow has a linear prelude (`fetch → emit → ...`), only `fetch` is the start node. The loop target `emit` is NOT a start node — it receives a back-edge. Don't give it stadium shape unless it's truly the first node to execute.

## Fan-out / fan-in

- **Fan-out**: multiple outgoing edges from one node execute in parallel (subject to top-level `parallel: false` if you want serial).
- **Fan-in**: a node with multiple incoming edges waits for *all* upstream tokens to complete before running.

```mermaid
flowchart TD
  start --> a
  start --> b
  start --> c
  a --> join
  b --> join
  c --> join
  join --> finish
```

Here `start` fans out to three parallel steps; `join` runs once after all three finish.

## Loops and fan-in

A loop target (node receiving a back-edge) can deadlock if it's treated as a fan-in merge. The rule:

> A node is a fan-in merge ONLY when ALL incoming edges are unlabeled AND come from distinct sources.

If any incoming edge is labeled, the node is NOT a merge — tokens fire it immediately.

**Safe loop pattern** — label the back-edge:

```mermaid
flowchart TD
  emit([Emit next])
  emit -->|next| process
  emit -->|done| finish
  process -->|loop| emit
```

Here `emit` has two incoming edges (it's the start node, plus `process -->|loop| emit`), but the back-edge is labeled, so no fan-in wait.

**Deadlock pattern** — all unlabeled incoming:

```mermaid
flowchart TD
  fetch --> emit
  emit -->|next| process
  emit -->|done| finish
  process --> emit
```

Here `emit` has unlabeled edges from both `fetch` and `process` → treated as merge → deadlocks on iteration 2.

**Fix:** `process -->|loop| emit` (label the back-edge).

## Self-edges

Self-edges ARE supported. They're the basis of edge-level retry:

```mermaid
flowchart TD
  fetch([Fetch data])
  fetch -->|pass| process
  fetch -->|fail max:3| fetch
  fetch -->|fail:max| fallback
```

The engine tracks a per-node retry counter for `fail max:N` self-edges.

## forEach (thick edges)

A thick edge (`==>`) with an `each:` label declares dynamic task mapping:

```mermaid
flowchart TD
  produce ==>|each: items| process --> collect
```

- The source step (`produce`) emits an array in `LOCAL.items`.
- The engine spawns one token per element through the body chain.
- The collector (`collect`) waits for all items to complete.
- Multi-node body chains are supported: `produce ==>|each: items| A --> B --> collect`.

Configure on the source step's `foreach:` config block:

```yaml
foreach:
  maxConcurrency: 3       # 0 = unlimited (default), 1 = serial
  onItemError: continue   # or: fail-fast (default)
```

## Subgraphs

`subgraph NAME ... end` is parsed. Nodes inside are included in the graph normally. Subgraph grouping metadata isn't used by the executor today (display-only / future visualization).

## Common graph shapes

### Linear pipeline
```mermaid
flowchart TD
  a --> b --> c
```

### Branch on result
```mermaid
flowchart TD
  check -->|pass| deploy
  check -->|fail| notify
```

### Retry with exhaustion handler
```mermaid
flowchart TD
  test -->|pass| deploy
  test -->|fail max:3| fix
  test -->|fail:max| abort
  fix --> test
```

### Loop (emitter pattern)
```mermaid
flowchart TD
  emit([Emit next item])
  emit -->|next| handle
  emit -->|done| finalize
  handle --> emit
```
