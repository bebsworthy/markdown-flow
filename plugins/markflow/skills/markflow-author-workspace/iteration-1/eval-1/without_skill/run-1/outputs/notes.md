# Notes

## Approach

Modeled the workflow on the engine's "emitter pattern" loop example
(`docs/examples/loop.md`): one step owns a cached collection and a cursor in
`LOCAL`, publishes the current item to `GLOBAL`, and uses a back-edge from
later steps to re-enter itself until exhausted. Exit is via an explicit
`RESULT: {"edge":"done"}` that the Mermaid flow routes to a terminal step.

Pipeline:

1. `fetch` — one-shot: `gh pr list --state open` into `prs.json` in the run
   workdir. Stores `total` on `GLOBAL` for the final summary.
2. `emit` — advances a cursor, publishes `GLOBAL.pr`, routes `next`/`done`.
3. `summarize` — agent step (`claude`, sonnet) that reads `GLOBAL.pr` via
   Liquid and is instructed to emit the paragraph as `LOCAL: {"summary":...}`.
4. `print` — bash step that reads `STEPS.summarize.local.summary` and echoes
   it with a header. Because the engine's stdout is tee'd to the event log
   live, the user sees each summary as it is produced — before the next PR
   is fetched from the cursor. This satisfies the "printed as it's
   generated" requirement.
5. `done` — prints a final count.

## Assumptions

- `gh`, `jq`, and `jo` are on `PATH` and `gh` is authenticated (matches the
  assumption in the repo's own `loop.md` example).
- The user has the `claude` agent configured (the default agent shown in
  example workflows in this repo). Model is set to `sonnet` for quality;
  change to `haiku` for speed/cost.
- "Open PRs" defaults to `@me` (PRs authored by the running user) via the
  `author` input. Setting `author` to a username or removing the filter
  would broaden the scope; I kept it scoped because "my open PRs" is the
  natural reading of the request.
- One paragraph = 4–7 sentences, prose, no bullets. Enforced via prompt.
- Separated `summarize` (agent) from `print` (bash) so that the printing is
  deterministic and doesn't rely on the agent's own stdout formatting — the
  agent only needs to emit a single `LOCAL:` line with the JSON-escaped
  paragraph, and the bash step handles presentation.

## Things I did not do

- No retries / timeouts configured. The engine supports both; sensible
  additions would be a per-step `retry:` on `summarize` (agent calls can
  transiently fail) and a `timeout:` on `fetch`. Left off to keep the
  example minimal.
- No pagination beyond `--limit` (default 50). Good enough for the common
  "my open PRs" case.
- No diff body is included in the agent prompt — just the PR description,
  file list, and +/- stats. Including the actual diff would improve review
  quality but blow up token cost; easy to add by piping `gh pr diff` into
  `prs.json` per-PR inside `fetch` or lazily inside `summarize`.
