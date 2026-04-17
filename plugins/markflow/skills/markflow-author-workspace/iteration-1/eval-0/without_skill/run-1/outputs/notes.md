# Notes

## Approach

Three-step linear pipeline with a failure branch:

1. `fetch-weather` — bash script that pulls current conditions from `wttr.in`
   (free, no API key) using `?format=j1` JSON. It extracts the fields a dog-walk
   recommendation actually cares about (temp, feels-like, description,
   precipitation, wind, humidity) and publishes them on `GLOBAL` so both the
   agent step and the final renderer can read them with `{{ GLOBAL.* }}` /
   `$GLOBAL`.
2. `recommend` — a Claude agent step (Haiku model for speed/cost) that reads
   the `GLOBAL` fields via LiquidJS templating in its prose prompt and is
   instructed to emit exactly one sentence on a `LOCAL:` sentinel.
3. `done` — bash script that reads the agent's `LOCAL.recommendation` from
   `STEPS` and prints it with a small header.

A separate `error` step handles the `fail` edge out of `fetch-weather` so the
run fails cleanly (non-zero exit) with a readable message if wttr.in is
unreachable or the city is invalid.

## How the `city` input is passed at run time

`city` is declared in the `# Inputs` section, which (per the engine's input
conventions used throughout the repo's examples, e.g.
`docs/examples/plane-ticket-analysis.md`) is exposed to step scripts as an
environment variable of the same name and to agent/template contexts via
`GLOBAL`/Liquid. At run time the user passes it with:

```
markflow run workflow.md --input city="New York"
```

(Exact CLI flag name for inputs wasn't verified against the CLI source during
this task — see "Assumptions" below.)

## Assumptions

- **Input wiring**: I assumed declared inputs are available to bash steps as
  env vars (`$city`) and to Liquid templates as `GLOBAL.city`, matching the
  pattern in `docs/examples/plane-ticket-analysis.md`. To remove any
  ambiguity, `fetch-weather` explicitly re-publishes `city` onto `GLOBAL`
  itself so downstream steps can rely on `{{ GLOBAL.city }}` regardless of how
  inputs are initially surfaced.
- **Routing convention**: Used the `RESULT: {"edge":"pass"|"fail", ...}` +
  `exit 1` pattern plus labeled edges (`|pass|`, `|fail|`) in the Mermaid
  flowchart, as in the plane-ticket example.
- **Agent directive**: Used a top-of-step ` ```config ` block with
  `agent: claude` and `--model haiku`, matching `01-linear.md` and the plane
  ticket example.
- **No API keys needed**: Chose `wttr.in` specifically so the workflow runs
  with zero configuration — just `curl` + `jq`.
- **Single sentence constraint** is enforced only by prompt instruction; the
  engine does not validate agent output length.
