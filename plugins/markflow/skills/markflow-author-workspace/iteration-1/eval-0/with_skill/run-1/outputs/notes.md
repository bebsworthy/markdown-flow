# Notes

## Shape

Three-step linear pipeline:

```
fetch_weather --> recommend --> render
```

- `fetch_weather` (bash): geocodes the `city` input via Open-Meteo's free
  geocoding API, then fetches current conditions from Open-Meteo's forecast
  API. Publishes a `weather` object on `GLOBAL`.
- `recommend` (agent, claude haiku): reads `{{ GLOBAL.weather.* }}` in its
  Liquid-templated prompt and emits a one-sentence recommendation on a
  `LOCAL` sentinel.
- `render` (bash): reads `STEPS.recommend.local.recommendation` and prints
  a small formatted block.

## Why Open-Meteo

It's free, keyless, and needs no account — so the workflow runs end-to-end
without any setup beyond `curl` + `jq`. Geocoding + current-weather endpoints
are both public.

## Runtime input

`city` is declared in `# Inputs` as required. At run time:

```
markflow run workflow.md --input city="Paris"
```

Inputs are exposed to every step as env vars and as bare Liquid variables
in agent prompts.

## Edge cases handled

- Missing `city` env var → `fetch_weather` exits 1 with a clear message.
- City that can't be geocoded (zero results from the API) → exits 1 with
  "could not geocode city '…'".
- `curl -f` makes upstream HTTP errors fail the step (non-zero exit routes
  via `fail`, but we have no `fail` edge — so the run halts, which is the
  desired behaviour for an unrecoverable API outage).
- `render` uses `// "(no recommendation produced)"` in jq so it degrades
  gracefully if the agent forgot the LOCAL sentinel.
- Country name in the prompt is guarded with `{% if country != "" %}` so
  the prompt never contains a trailing comma when the geocoder returns
  no country.

## Validation

Ran `markflow init` against the file with a throwaway workspace:

```
node packages/markflow/dist/cli/index.js init <workflow.md> -w /tmp/markflow-validate-$$
```

Exit code 0 — structurally valid (topology matches step headings, no
orphan nodes, no unpaired retry handlers, config keys all recognized).
See `validation.txt`.

## How to run

```bash
markflow run workflow.md --input city="Paris"
# or
node packages/markflow/dist/cli/index.js run workflow.md --input city="Paris"
```
