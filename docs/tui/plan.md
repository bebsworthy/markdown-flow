# markflow-tui — Build Plan

> **How to resume.** Run `cat docs/tui/plan.md` (or `@docs/tui/plan.md` in a Claude session) to pick up where the last session left off. Each task has a status checkbox — the orchestrator is responsible for keeping them accurate. Find the first task whose status is `[ ]` and work from there.

**Primary references** (every task should cite the relevant sections rather than paraphrase):

- [`docs/tui/features.md`](./features.md) — feature list (§3), IA / layouts / keybar (§5), technical approach (§6), required engine API additions (§7).
- [`docs/tui/mockups.md`](./mockups.md) — 15 ASCII mockups, one per screen/state.
- [`docs/tui/testing.md`](./testing.md) — test-layer strategy (unit / ink-testing-library / node-pty / VHS).
- [`CLAUDE.md`](../../CLAUDE.md) — engine architecture & conventions.

Any deviation from these specs must be discussed with the user before proceeding — **the plan is not authority to redesign**.

---

## Orchestration protocol

The orchestrator (main session) does **not** implement tasks itself. For each open task it runs this loop:

### Per-task loop

1. **Plan** — spawn a *Plan* agent (general-purpose) with the task body below + links to features.md / mockups.md. The agent produces a concrete technical plan saved to `docs/tui/plans/<task-id>.md` covering:
   - files to create / modify (absolute paths)
   - exported names + signatures
   - data-flow diagram if non-trivial
   - test matrix (what each test file covers)
   - risks, unknowns, required clarifications
   - explicit acceptance criteria lifted verbatim from plan.md + any derived sub-criteria
2. **Review plan with user** (optional) — if the plan introduces design decisions not covered by features.md/mockups.md, surface them briefly before implementation.
3. **Implement** — spawn an *Implementation* agent (general-purpose) with:
   - the task body from plan.md
   - the technical plan from step 1
   - explicit scope limits ("do not touch files outside the allow-list")
4. **Validate** — run the commands in the task's "Validation" block. If any fail, return to step 3 with the failure output.
5. **Verify against spec** — spawn a *Verifier* agent (general-purpose) with the acceptance criteria + the changed files. The verifier reads `features.md` / `mockups.md` and reports whether the implementation matches. If it reports gaps, return to step 3.
6. **Commit** — once validation passes and the verifier signs off, stage only the files the task touched and commit with the convention in §Commit conventions below. Mark the checkbox `[x]` in this file and move on.

### Agents

| Role | Kind | Typical tools |
|---|---|---|
| Plan | `general-purpose` | Read, Grep, Glob, Write |
| Implementation | `general-purpose` | Read, Edit, Write, Bash, Grep, Glob |
| Verifier | `general-purpose` | Read, Grep, Glob, Bash |

Each agent prompt must include the task's acceptance criteria verbatim and link to the spec sections. Agents should **never** be told to "figure it out" — specs are authoritative; if a spec is ambiguous, the agent returns a question.

### Global rules applied to every task

- **Branch & commit.** Work on the default branch. One commit per validated task. Commit format:
  ```
  <type>(<scope>): <short imperative summary>

  - Implements <task-id> from docs/tui/plan.md.
  - References: features.md §<x>, mockups.md §<y>.
  ```
  where `type` ∈ {`feat`, `chore`, `test`, `refactor`, `docs`} and `scope` ∈ {`tui`, `engine`, `monorepo`, `ci`}.
- **No skipping tests.** Every task ends with `npm test` (at the relevant workspace) green. No `.skip`, no `xit`, no commented-out assertions.
- **No lint regressions.** `npm run lint` green. TypeScript strict; no `any` leaking into public surfaces.
- **Type-first.** For tasks touching public APIs, types go in *before* implementation, and exports from `packages/markflow/src/core/index.ts` are explicit.
- **Hide-don't-grey.** Any UI task referencing keybars / menus must follow features.md §5.6 rule 5: disabled items are omitted, never shown greyed.
- **Consistent layout primitive.** Every Run/Runs screen uses the stacked top/bottom layout described in mockups.md §1 / §4 / §6 / §12 / §13. Agents must *not* invent alternative layouts.
- **Workflow registry scope.** The TUI never auto-scans the filesystem for workflows. Manual registry only (features.md §3.1).
- **CLI purity.** `packages/markflow/package.json` must not acquire Ink, React, or any terminal-UI runtime dep. A task that needs something in `packages/markflow` should ask first.

---

## Validation gates

Every task runs these at minimum (from the repo root, via npm workspaces):

```bash
npm run lint -w packages/markflow-tui
npm test -w packages/markflow-tui -- --run
```

Plus engine-side checks when a Phase-1 task touches the `markflow` package:

```bash
npm run lint -w packages/markflow
npm test -w packages/markflow -- --run
npm run build -w packages/markflow
```

Phase-9 tasks additionally run the E2E harness:

```bash
npm run test:e2e -w packages/markflow-tui
```

Any task that modifies the public API of `markflow` must also run the full engine test suite — this catches regressions in existing CLI paths.

---

## Phase 0 — Monorepo setup

### [x] P0-T1 — Convert repo to npm workspaces with two packages

**Reference.** features.md §6.5 "Packaging & distribution".

**Scope.**
- Create `packages/markflow/` and move everything currently under `src/`, `test/`, `bin/`, plus `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` into it.
- Move existing `package.json` into `packages/markflow/package.json` (keep the `markflow` name, current version).
- Create new root `package.json` declaring `"workspaces": ["packages/*"]` and a minimal scripts surface that delegates to workspaces (`test`, `lint`, `build` with `-w` forwarding).
- Leave `docs/` and `README.md` at the repo root (unchanged).
- Create `packages/markflow-tui/` as an empty scaffold with its own `package.json` (no code yet — next phase populates it). It declares `markflow` as a workspace dep via `"markflow": "workspace:*"`.
- Update any internal scripts that referenced the old layout.
- Verify `npm install` at the root installs both workspaces and `npm test -w packages/markflow` still passes.

**Out of scope.** TUI code, lint config for TUI, CI config beyond what exists.

**Acceptance criteria.**
- Running `npm install` at the repo root succeeds with no warnings about missing workspaces.
- `npm test -w packages/markflow` passes the full existing engine test suite.
- `npm run build -w packages/markflow` produces `packages/markflow/dist/` with both `core/index.js` and `cli/index.js` entry points (as today).
- `packages/markflow-tui/package.json` exists, declares `markflow` as a workspace dep, has a `bin: { "markflow-tui": "./dist/cli.js" }` entry (binary file can be a stub for now).
- No file under `packages/markflow/` imports from `packages/markflow-tui/`.
- Repo-level `.gitignore` includes `packages/*/dist/` and `packages/*/node_modules/`.

**Validation.**
```bash
npm install
npm test -w packages/markflow -- --run
npm run build -w packages/markflow
```

---

## Phase 1 — Engine public-API additions (§7 gaps)

The TUI cannot start consuming `markflow` until these are exported. Land them in dependency order: pure utilities first, stateful helpers last.

### [x] P1-T1 — Re-export graph helpers and add batch membership query

**Reference.** features.md §7 rows "Graph helpers not re-exported" and "Batch membership query".

**Scope.**
- Re-export `getTerminalNodes`, `getUpstreamNodes`, `isMergeNode` (and any close siblings) from `packages/markflow/src/core/graph.ts` through `packages/markflow/src/core/index.ts`.
- Add a new pure helper `tokensByBatch(snapshot: EngineSnapshot, batchId: string): Token[]` — O(n) scan over `snapshot.tokens`, returning the children of a given forEach batch. Place in a new `src/core/queries.ts` or extend `graph.ts`; do not duplicate type definitions.
- Unit tests covering both helpers against fixture snapshots.

**Out of scope.** Any change to the token model or snapshot shape.

**Acceptance criteria.**
- `import { getTerminalNodes, getUpstreamNodes, isMergeNode, tokensByBatch } from "markflow"` works from a downstream consumer.
- `tokensByBatch` returns `[]` for an unknown batch id, not `undefined`.
- No changes to existing call sites.

**Validation.** Engine suite green.

### [x] P1-T2 — Sidecar stream resolver

**Reference.** features.md §7 row "No sidecar resolver"; architecture in `docs/arch/event-sourced-run-log.md`.

**Scope.**
- Add `getSidecarStream(runDir: string, seq: number, stream: "stdout" | "stderr"): Promise<ReadableStream<Uint8Array>>` to the public API. Resolves the sidecar path deterministically from `runDir` + `seq` + stream.
- Rejects with a typed error if the sidecar does not exist (distinct from generic `ENOENT`).
- Unit tests with a tmpdir fixture.

**Out of scope.** Log-pane consumption (Phase 6).

**Acceptance criteria.** Function is exported, tested, and used nowhere in this task (TUI will consume it later).

### [x] P1-T3 — Incremental event tail

**Reference.** features.md §7 row "Incremental event tail".

**Scope.**
- Add `tailEventLog(runDir: string, fromSeq: number): AsyncIterable<EngineEvent>` to the public API.
- Streams existing events from `fromSeq` onward, then continues reading appended events until the run terminates or the consumer aborts (via `AbortSignal` argument).
- Handles partial tail lines (file being written mid-read) — either buffer until newline or restart on inconsistent length.
- Unit tests: attach mid-run to a fixture run directory; assert events arrive in order; assert clean termination on abort.

**Out of scope.** `RunManager.watch` (next task).

**Acceptance criteria.**
- `AsyncIterable` contract respected (break exits cleanly; no leaked `fs.watch` handles).
- Never skips events; never duplicates them.
- Unit tests cover: cold start with N events present, attach before any events, writer appends while consumer is awaiting.

### [x] P1-T4 — RunManager watch API

**Reference.** features.md §7 row "No watch API".

**Scope.**
- Add `runManager.watch(): AsyncIterable<RunEvent>` where `RunEvent = { kind: "added" | "updated" | "removed"; runId: string; snapshot?: RunInfo }`.
- Backed by `fs.watch` on the runs directory (plus per-run `meta.json`), debounced 50ms.
- Unit tests that spawn a mock run and assert `added` fires.

**Out of scope.** UI polling — TUI will consume this.

**Acceptance criteria.**
- `for await` works; abort via `AbortSignal` cleans up watchers.
- No busy-loop; idle CPU < 1%.

### [x] P1-T5 — Concurrent-resume file lock

**Reference.** features.md §7 row "No concurrent-resume guard".

**Scope.**
- On opening an existing run for resume, acquire an exclusive file lock at `runs/<id>/.lock` (use `proper-lockfile` or equivalent).
- Release on process exit and on normal completion.
- Throw a typed `RunLockedError` (exported) if the lock is held.
- Update `resume` entry point to surface this error cleanly in the existing CLI too.

**Out of scope.** TUI integration.

**Acceptance criteria.**
- Two concurrent `resume` attempts on the same run: second fails fast with `RunLockedError`.
- Existing single-process resume path unaffected.

---

## Phase 2 — TUI package scaffolding

### [x] P2-T1 — Ink project skeleton, build config, binary entrypoint

**Reference.** features.md §6.1 (Stack), §6.5 (Packaging).

**Scope.**
- Populate `packages/markflow-tui/` with:
  - `package.json`: deps `ink`, `@inkjs/ui`, `react`, runtime dep `markflow: workspace:*`, dev deps `tsup`, `typescript`, `vitest`, `ink-testing-library`.
  - `tsconfig.json` extending a shared base at the root (create `tsconfig.base.json` with `strict: true`, `moduleResolution: "bundler"`, JSX `"react-jsx"`).
  - `tsup.config.ts` producing ESM only with shebang on the CLI entry.
  - `src/cli.tsx` — minimal Ink app that renders "markflow-tui · scaffold" and exits cleanly on `q`.
  - `src/app.tsx` — empty root component.
- Binary name `markflow-tui` wired via `bin` field.

**Out of scope.** Any real feature.

**Acceptance criteria.**
- `npm run build -w packages/markflow-tui` produces a binary that runs and exits cleanly.
- TypeScript strict mode on; `npm run lint -w packages/markflow-tui` passes (lint = `tsc --noEmit`).
- No runtime dep on anything beyond Ink + React + `markflow`.

### [x] P2-T2 — Unit + component test harness

**Reference.** testing.md §Recommended 5-layer stack (layers 1 + 2).

**Scope.**
- `vitest.config.ts` in the tui package with `jsdom` off, `happy-dom` or `node` env.
- Example tests:
  - `test/reducer.placeholder.test.ts` — proves vitest works.
  - `test/components/scaffold.test.tsx` — uses `ink-testing-library` to render the scaffold app and assert output.
- `npm test` script and CI-friendly `npm test -- --run` (no watch).

**Acceptance criteria.** Both tests pass; harness documented in a short `packages/markflow-tui/test/README.md`.

### [x] P2-T3 — Lint config, CI workflow, VHS stub

**Reference.** testing.md §Recommended 5-layer stack (layer 5 visual regression — scaffold only).

**Scope.**
- `npm run lint` at repo root runs lint across both workspaces.
- GitHub Actions workflow (or equivalent) running `install + lint + test + build` on every push. Separate jobs per workspace so a TUI failure doesn't block CLI releases.
- VHS config scaffolding under `packages/markflow-tui/vhs/` — a single `scaffold.tape` that records the empty app and writes to `out/scaffold.gif`. Not run in CI yet (gated behind a workflow dispatch).

**Acceptance criteria.** CI runs green on a clean checkout; `vhs --help` path documented in `vhs/README.md` for local use.

---

## Phase 3 — TUI foundation

### [x] P3-T1 — Core state model, reducer, mode FSM

**Reference.** features.md §5.1 (IA), §6.2 (Data flow), §6.3 (Mode FSM sketch).

**Scope.**
- `src/state/types.ts`: `Mode`, `Focus`, `Overlay`, `AppState` types mirroring §6.2.
- `src/state/reducer.ts`: pure `(state, action) => state`. Actions cover mode transitions, focus changes, overlay open/close, filter input.
- Unit tests: every transition in §5.1 covered.

**Out of scope.** Engine events (next task).

**Acceptance criteria.** Reducer is pure (no I/O imports). FSM graph in comments matches features.md §5.1 tree.

### [x] P3-T2 — Engine adapter (event ingestion)

**Reference.** features.md §6.2 (Data flow).

**Scope.**
- `src/engine/adapter.ts` wrapping `runManager.watch` (P1-T4) and `tailEventLog` (P1-T3) into a single async iterable feeding reducer actions.
- Subscription lifecycle tied to React `useEffect` with `AbortController`.
- Unit tests against fixture run dirs.

**Acceptance criteria.** No polling; unsubscribes cleanly on unmount.

### [ ] P3-T3 — Theme tokens, glyphs, fallback

**Reference.** features.md §5.10 (Visual vocabulary); mockups.md §14 (monochrome / ASCII fallback).

**Scope.**
- `src/theme/tokens.ts` — color roles (`status.ok`, `status.failed`, `status.running`, `accent`, `dim`, `danger`).
- `src/theme/glyphs.ts` — two tables: unicode (`⊙ ▶ ✓ ✗ ○ ⏸ ↻ ⏱ ⟳ →`) and ASCII fallback (`[wait] [run] [ok] [fail] [skip] [wait] [retry] [time] [batch] ->`).
- Capability detection: `NO_COLOR`, `TERM=dumb`, locale-based unicode support.
- `useTheme()` hook returning the active glyph + color tables.

**Acceptance criteria.** Setting `NO_COLOR=1` disables all color; setting `MARKFLOW_ASCII=1` forces the ASCII glyph set. Unit tests for both paths.

### [ ] P3-T4 — Keybar primitive + responsive tiers

**Reference.** features.md §5.6 (full keybar rules, all 10).

**Scope.**
- `src/components/keybar.tsx` accepting a `Binding[]` (types as in §5.6) and rendering according to the three-tier fallback (full ≥100 cols, short 60–100, keys-only <60).
- Respects: inline category labels, destructive = red, hide-don't-grey, toggle-label flip, mode pill rendering.
- Component tests cover all ten rules from §5.6.

**Acceptance criteria.** Given a fixture Binding array and three widths, snapshot output matches the mode × width matrix in mockups.md §15.

### [ ] P3-T5 — App shell frame + mode-tab row

**Reference.** mockups.md §1, §4, §6 (top row + outer frame).

**Scope.**
- `src/components/app-shell.tsx`: renders the outer `╔═══╗` frame, top mode-tab row (`WORKFLOWS  RUNS  RUN`) with active pill `[ RUNS ]` style, and reserves top-half / bottom-half slots that children fill.
- `src/components/mode-tabs.tsx` with keyboard bindings (`F1/F2/F3` or `1/2/3`) wired via reducer actions.
- Component tests covering active-tab highlighting.

**Acceptance criteria.** Rendered shell at 140 cols is within 1 column of the mockup in mockups.md §1 (compared via snapshot).

---

## Phase 4 — Workflow browser

### [ ] P4-T1 — Workflow registry persistence

**Reference.** features.md §3.1 (Persistence paragraph).

**Scope.**
- `src/registry/store.ts` with `loadRegistry(cwd)`, `addEntry`, `removeEntry`, `saveRegistry` (atomic write via temp + rename).
- File format: `./.markflow-tui.json` exactly as specified (JSON array of `{ source, addedAt }`).
- Support `--no-save` and `--list <path>` options via an injected `registryPath` config.
- Unit tests for malformed JSON (should not throw, should log and start empty), write atomicity, concurrent writes.

**Acceptance criteria.** Round-trip add → save → load preserves entries. Corrupt file starts empty list and preserves corrupted file at `.markflow-tui.json.bak`.

### [ ] P4-T2 — Workflow browser pane with preview

**Reference.** features.md §3.1 (Display paragraph); mockups.md §2.

**Scope.**
- Two-pane layout (list left, preview right). List rows show source-badge, title, last-run status, validity flag.
- Resolves each entry lazily (parse the `.md` file or read workspace `.markflow.json`).
- Preview renders parsed sections (title, inputs, Mermaid-as-text summary, step counts, diagnostics) — consumes `parseWorkflow` + `validateWorkflow` from `markflow`.
- Invalid entries stay visible with `✗ parse` / `✗ 404` flag.

**Out of scope.** Add/remove modal (next task).

**Acceptance criteria.** Matches mockups.md §2 layout to within column rounding.

### [ ] P4-T3 — Add modal (fuzzy-find + path/URL tabs), empty state

**Reference.** features.md §3.1 (Adding from inside the TUI); mockups.md §2 (add-modal + empty-state mocks).

**Scope.**
- Modal with two tabbed input modes (`Tab` toggles). Fuzzy-find walks the filesystem from a configurable root (default CWD, `Ctrl+Up` opens root-picker text input, no disk restriction).
- Filter to valid workflows only (parse check) + workspace dirs (contain `.markflow.json`).
- URL tab materialises the workspace immediately via the existing `markflow run <url>` bootstrap code path (reuse, do not duplicate).
- `d` removes an entry from the list only.
- Empty state (first-launch) per mockups.md §2 — single pane with "no workflows registered yet" hint, keybar restricted to `a / ? / q`.

**Acceptance criteria.** User can launch `markflow-tui ./some.md`, see it added, quit, relaunch with `markflow-tui`, see it persisted. All three interaction paths (launch arg, fuzzy find, URL paste) produce a registry entry.

---

## Phase 5 — Runs mode (stacked layout)

### [ ] P5-T1 — Runs table component (columns, sort, status glyphs)

**Reference.** features.md §3.2; mockups.md §1 top half, §3.

**Scope.**
- Table with columns `ID · WORKFLOW · STATUS · STEP · ELAPSED · STARTED · NOTE`.
- Default sort = attention-first (active bucket by `started` desc, terminal bucket by `ended` desc). `s` cycles sort columns.
- Status cells use theme glyphs; red for `failed`, green for `ok`, yellow for `running`.
- Component tests against fixture run snapshots.

**Out of scope.** Filtering, archive toggle (next task).

**Acceptance criteria.** Matches mockups.md §1 top half layout.

### [ ] P5-T2 — Filter, archive toggle, virtualised render

**Reference.** features.md §3.2 (Archive handling paragraph, Virtualised render paragraph); mockups.md §1 (`N shown · M archived · a Show all`).

**Scope.**
- `/` opens filter bar supporting `status:`, `workflow:`, `since:`, free-text id-prefix.
- `a` toggles archive inclusion; default hides completions >24h + failures >7d.
- Virtualised render draws only visible rows (windowed slice ~30–50). Verify with a 10 000-entry fixture — render time budget.
- Footer shows `N shown · M archived · a Show all` and reflects live counts.

**Acceptance criteria.** 10 k fixture renders without jank (measured via a perf test in vitest — assert render < 16ms / frame).

### [ ] P5-T3 — Mode wiring + cursor follow-selection

**Reference.** features.md §5.1 (IA); mockups.md §1 (cursor live-updates bottom pane).

**Scope.**
- Selecting a row in the runs table broadcasts the run id to the bottom pane — placeholder at this stage, filled in Phase 6.
- `Enter` zooms the bottom pane full-screen (switches to RUN mode) and hides the runs table. `Esc` returns.
- Mode-tab pill updates to `[ RUN ]` in RUN mode.

**Acceptance criteria.** Mode transitions match features.md §5.1 exactly. No orphan state when zooming in and back out.

---

## Phase 6 — Run mode (step table + tabbed pane)

### [ ] P6-T1 — Step table for a single run

**Reference.** features.md §3.3 (Live run viewer); mockups.md §4, §6.

**Scope.**
- Tree-indented step rows with columns `STEP · STATUS · ATTEMPT · ELAPSED · NOTE`.
- Parent/child via indentation (fan-out parents, children under them). `forEach` batches render as a single aggregate row with progress bar when child count > collapse threshold.
- Retry countdown in NOTE column fed by `step:retry.delayMs`.
- `upstream: failed` for skipped rows.

**Acceptance criteria.** Matches mockups.md §4 (running) and §6 (terminal) layouts under identical widths.

### [ ] P6-T2 — Detail tab content

**Reference.** features.md §3.4; mockups.md §1, §4, §6 bottom pane.

**Scope.**
- Fields: type, attempt, timeout, exit, edge, route-to, local, global, last-log-line, stderr tail (last 3 lines, link to Log tab for full).
- Values come from the snapshot projected via `replay()`.

**Acceptance criteria.** Rendering matches the detail panes in mockups §1/§4/§6.

### [ ] P6-T3 — Log tab (streaming, follow, pause, ANSI)

**Reference.** features.md §3.5; mockups.md §8, §9.

**Scope.**
- Consumes `getSidecarStream` (P1-T2) for the selected step's `seq`.
- `f` toggles follow. Scrolling past last line enters **paused** mode with a banner (mockups §9).
- Interpret ANSI color; strip incompatible escape sequences.
- `w` toggles wrap vs truncate.

**Acceptance criteria.** Following a live stream updates within 100ms of an event append; paused mode freezes output.

### [ ] P6-T4 — Graph tab + Events tab

**Reference.** mockups.md §1 tab group; features.md §3.3 (indented DAG).

**Scope.**
- **Graph tab** — the indented DAG tree rendered full-size (same tree as step table but with graph-specific framing; reuse P6-T1 rendering).
- **Events tab** — textual stream of raw `EngineEvent` records for the selected run, filterable by kind. Useful for debugging.

**Acceptance criteria.** `1/2/3/4` switches tabs without losing scroll position per tab.

---

## Phase 7 — Overlays

### [ ] P7-T1 — Approval modal

**Reference.** features.md §3.6, §3.7; mockups.md §5.

**Scope.**
- Modal with prompt, radio-selectable edges, `[ ⏎ Decide ] [ s Suspend ]` buttons.
- `[APPROVAL]` mode pill in keybar (reverse video).
- Calls the engine's approval control op; updates are visible via the event stream.
- Pending-approvals indicator badge (`a Approve (N)`) computed from current snapshot.

**Acceptance criteria.** Matches mockups.md §5 exactly. No `e Edit inputs` button (removed earlier).

### [ ] P7-T2 — Resume wizard

**Reference.** features.md §3.8; mockups.md §7.

**Scope.**
- Modal opened by `R Re-run` on a failed run.
- Multi-select for `--rerun` nodes (pre-populates with the failing node).
- Key/value editor for `--input` overrides.
- Confirm calls `executeWorkflow` with `resumeFrom`.

**Acceptance criteria.** Matches mockups.md §7 layout.

### [ ] P7-T3 — Command palette + help overlay

**Reference.** features.md §3.10; mockups.md §10 (palette) and §11 (help).

**Scope.**
- `:` opens command bar with filtering against the known command list (`:run`, `:resume`, `:rerun`, `:cancel`, `:approve`, `:pending`, `:goto`, `:theme`, `:quit`).
- `?` opens context-sensitive help overlay — only bindings active in the current mode.

**Acceptance criteria.** Help content derived from the same keymap used by the keybar (single source of truth, features.md §5.6 rule 8).

---

## Phase 8 — Responsive tiers + monochrome

### [ ] P8-T1 — Medium tier (~90 cols)

**Reference.** features.md §5.3; mockups.md §12.

**Scope.**
- Column-drop order: `STARTED` → compact `ELAPSED` as `AGE` → fold `ATTEMPT` into `STEP`.
- Tab labels compress to `[G]raph` / `[D]etail` / `[L]og` / `[E]vents`.
- Keybar switches to short tier (§5.6 rule 7).

**Acceptance criteria.** At width=90, render matches mockups.md §12 ± 1 column.

### [ ] P8-T2 — Narrow tier (<60 cols) + monochrome / ASCII fallback

**Reference.** features.md §5.4; mockups.md §13 (narrow), §14 (monochrome).

**Scope.**
- At <60 cols: breadcrumb replaces mode tabs; one pane at a time (runs → steps → step-detail). Drill via `Enter`, pop via `Esc`.
- Keybar = keys-only tier with `? for labels` hint.
- `MARKFLOW_ASCII=1` forces ASCII glyphs + no box-drawing — mockups.md §14 layout.

**Acceptance criteria.** Both mockups match ± 1 column. `NO_COLOR=1 MARKFLOW_ASCII=1` produces a fully accessible fallback rendering.

---

## Phase 9 — E2E and visual regression

### [ ] P9-T1 — node-pty integration harness + canonical user journeys

**Reference.** testing.md §Recommended stack layer 3 (node-pty integration) and §Anti-patterns.

**Scope.**
- `test/e2e/harness.ts` spawning the built binary via `node-pty` with a configurable `cols × rows` and ANSI stripping helper.
- Three journeys:
  1. Empty launch → `a` add workflow by path → `r` run → observe ▶ running → wait for ✓.
  2. Failed run → `R` re-run via resume wizard → pick node → confirm.
  3. Approval pending → `a` → decide → run resumes.
- Timeouts explicit; flake budget = 0.

**Acceptance criteria.** All three journeys pass on macOS and Linux. No hard-coded sleeps; use readiness predicates.

### [ ] P9-T2 — VHS visual regression suite

**Reference.** testing.md §Recommended stack layer 5 (VHS); features.md §6.6.

**Scope.**
- `vhs/` contains one tape per mockup (§1, §2, §3, §4, §5, §6, §7, §12, §13).
- Golden GIFs committed under `vhs/golden/`; CI job (manual dispatch) compares freshly recorded GIFs pixel-diff style.
- `vhs/README.md` documents how to regenerate goldens intentionally.

**Acceptance criteria.** All tapes record without errors; at least the app-shell tape matches its mockup.

---

## Commit conventions

```
<type>(<scope>): <short imperative>

- Implements <task-id> from docs/tui/plan.md.
- References: features.md §<x>, mockups.md §<y>.
```

- `type` ∈ `feat` | `fix` | `chore` | `refactor` | `test` | `docs` | `ci`.
- `scope` ∈ `monorepo` | `engine` | `tui` | `ci`.
- Keep the summary ≤ 72 chars. Body bullets are concise — the plan + task id is the source of truth.

Example:
```
feat(tui): add workflow browser pane with lazy preview

- Implements P4-T2 from docs/tui/plan.md.
- References: features.md §3.1, mockups.md §2.
```

---

## Progress log

Every time the orchestrator finishes a task it appends one line here (most recent on top):

```
<ISO date>  <task-id>  <commit-sha>  <short note>
```

```
2026-04-16  P3-T2  68436c4  engine adapter (async iterable) + useEngineAdapter hook
2026-04-16  P3-T1  fec45c3  AppState types + pure reducer FSM (40 TUI tests)
2026-04-16  P2-T3  c89ad8e  GitHub Actions CI (engine + tui) + VHS scaffold
2026-04-16  P2-T2  525e0d7  vitest + ink-testing-library test harness
2026-04-16  P2-T1  c317501  scaffold Ink project; tsconfig.base.json + src/
2026-04-16  P1-T5  14b5bdc  concurrent-resume file lock + RunLockedError
2026-04-16  P1-T4  2ca0e61  add RunManager.watch() streaming RunEvents
2026-04-16  P1-T3  0439eb5  add tailEventLog async iterable over events.jsonl
2026-04-16  P1-T2  a3864cc  add getSidecarStream resolver + SidecarNotFoundError
2026-04-16  P1-T1  3aa29e8  re-export graph helpers; add tokensByBatch query
2026-04-16  P0-T1  d59d00d  npm workspaces; engine → packages/markflow, TUI scaffold → packages/markflow-tui
```
