# 13 — Agent Memory / Conversation Continuity

**Tier:** Differentiating | **Effort:** Medium (3-4 days) | **Priority:** Medium

## Problem

Agent steps start fresh on every invocation. In retry or loop scenarios, the agent has no memory of prior attempts — it can't learn from mistakes or build on previous work. This wastes tokens and reduces effectiveness.

## Reference Implementations

- **LangGraph:** `MemorySaver` / `checkpointer` for conversation persistence across graph traversals
- **CrewAI:** Agent memory (short-term, long-term, entity memory)
- **AutoGen:** Conversation history maintained across turns

## Proposed Design

### Config block

````markdown
## fix-code

```config
agent: claude
memory: conversation
```
````

### Memory modes

- **`none`** (default): Current behavior. Each invocation is independent.
- **`conversation`**: On re-entry (retry or loop), the agent receives its prior prompt+response pairs as conversation history.
- **`summary`**: On re-entry, a summary of prior interactions is prepended to the prompt (reduces token usage).

### How it works

Memory files follow the sidecar pattern established by idea 18: one file per invocation, keyed by the `stepSeq` of the owning `step:start` plus the `nodeId`:

```
runs/<id>/
  events.jsonl
  memory/
    0007-fix-code.json    # first invocation (step:start seq 0007)
    0019-fix-code.json    # retry attempt
    0034-fix-code.json    # loop iteration 2
```

**Re-entry detection is free under idea 18**: "this is the Nth invocation of node X" = `count(events where type === "step:start" && nodeId === X && seq < currentSeq)`. No separate counter needed.

On first invocation:
- Agent runs normally. Prompt and response are written to `runs/<id>/memory/<stepSeq>-<nodeId>.json`.

On re-entry (retry or loop iteration):
- The runner scans prior `step:start` seqs for this `nodeId` from the log, reads each corresponding sidecar memory file in order, and prepends the exchanges to the assembled prompt:
  ```
  [Previous attempt 1]
  Prompt: ...
  Response: ...
  Edge taken: fail
  
  [Previous attempt 2]
  Prompt: ...
  Response: ...
  Edge taken: fail
  
  [Current attempt 3]
  <actual prompt>
  ```

### Context window management

````markdown
## fix-code

```config
agent: claude
memory: conversation
memoryLimit: 5  # Keep only last 5 exchanges
```
````

### Optional event: `memory:recorded`

For discoverability in `markflow show --events`, emit a persisted `memory:recorded { stepSeq, nodeId, path }` event when the memory sidecar is written. Not strictly required — the runner and reader both know the path convention — but matches the `output:ref` pattern in idea 18 and lets tooling enumerate memory without scanning the filesystem.

### Resume interaction (idea 19)

On resume, agent memory for prior attempts is automatically preserved: the event log is intact, so `step:start` seqs for the node are unchanged, and the sidecar files still sit at their original paths. The agent runner's scan produces the same prior-exchanges list before and after resume — no special handling needed.

## Implementation Approach

1. Add `memory` and `memoryLimit` to `StepAgentConfig`.
2. In `agent.ts`, after step completion, write the prompt+response to `memory/<stepSeq>-<nodeId>.json` and (optionally) emit `memory:recorded`.
3. On re-entry, enumerate prior `step:start` events for this `nodeId` via the event log, read the sidecar files in seq order, and prepend to the assembled prompt.
4. For `summary` mode: use a simple heuristic (first line of each response) or delegate summarization to the agent itself.

## What It Extends

- `StepAgentConfig` in `types.ts` (new `memory`, `memoryLimit`)
- `agent.ts` runner (save/load memory, prompt assembly)
- Run directory structure (new `memory/` subdirectory)

## Key Files

- `src/core/runner/agent.ts`
- `src/core/types.ts`
- `src/core/parser/markdown.ts` (config parsing)
- `src/core/run-manager.ts` (memory directory management)

## Open Questions

- Should memory be shared across different agent steps, or strictly per-node?
- How to handle memory for `forEach` dynamic mapping (each item gets independent memory)?
- Should there be a way to explicitly clear memory (`CLEAR_MEMORY: true` sentinel)?
- Token budget awareness — should the engine trim memory to fit a known context window?
