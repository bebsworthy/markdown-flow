# Notes

## What the workflow does

Iterates over the current user's open GitHub PRs (`gh pr list --author @me`),
has a Claude agent write a one-paragraph review summary for each one, and
prints each summary as soon as it is generated — one PR per loop iteration.

## Shape

Classic **emitter-pattern loop** (per skill example 3):

- `emit` (stadium node, cyclic entry): fetches PR list once into the run
  workdir (`prs.json`), advances a cursor in `LOCAL`, publishes the current PR
  to `GLOBAL.item`. Routes `next` while items remain, `done` when exhausted.
- `review` (agent, Claude haiku): renders the PR title/body/URL/branches into
  a prompt via Liquid and emits the one-paragraph review as `RESULT.summary`.
- `print` (bash): reads `STEPS.review.summary` and echoes it immediately —
  this is what gives the user streaming output between loop turns.
- `print -> emit` back-edge drives the loop.
- `summary` (bash): prints total PR count after `emit` emits `done`.

## Key design choices

- Used `@me` via `gh pr list --author @me` so the user doesn't need to supply
  a username. No `# Inputs` section needed.
- The agent publishes its paragraph through `RESULT.summary` rather than
  `GLOBAL` — `summary` is the designated routing one-liner, and a single
  paragraph fits that role. `print` reads it via `STEPS.review.summary`.
- Kept the graph clean (no retry edges); a transient `gh` hiccup would surface
  as a normal failure. Could add step-level `retry:` to `emit` later if
  desired.
- `flags: [--model, haiku]` at the top level keeps the per-PR review cheap/fast.

## Validation

`markflow init` against a throwaway workspace returned exit 0 — see
`validation.txt`.

## How to run

```bash
node /Users/boyd/wip/markdown-flow/packages/markflow/dist/cli/index.js run \
  /Users/boyd/wip/markdown-flow/plugins/markflow/skills/markflow-author-workspace/iteration-1/eval-1/with_skill/outputs/workflow.md
```

Requires `gh` (authenticated), `jq`, `jo`, and the `claude` CLI on `PATH`.
