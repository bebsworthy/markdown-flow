# markflow-tui — Audit Report 01

> Date: 2026-04-19
> Scope: Full architecture, test methodology, and E2E functionality audit
> Compared against: `docs/tui/features.md`, `docs/tui/mockups.md`

---

## Executive Summary

The markflow-tui codebase is **architecturally sound in both its pure-logic layer and its multi-workspace design**. The core engine is mono-workflow (one `runs/` directory per workflow); the TUI is multi-workflow, giving each workflow its own workspace with isolated `runs/` storage. This separation is correct by design — it prevents run artifacts from different workflows mixing together.

The application has **real but bounded bugs** that surface primarily through E2E tests. The pure-logic tests (1680, all passing) correctly validate data transformations; the 5 consistent E2E failures trace to three root causes:

1. A **single-line bug in `resolver.ts:298`** passes the workspace root instead of `runs/` subdirectory to `createRunManager()`
2. **E2E test assertions check the wrong directory** for run artifacts (expecting `MARKFLOW_RUNS_DIR` when runs are correctly created in per-workflow workspaces)
3. **PTY timing races** where keystrokes arrive before overlay `useInput` handlers mount

The runs table has an **aggregation gap**: it only shows runs from `MARKFLOW_RUNS_DIR` (initial hydration) plus in-session runs, not historical runs from all registered workflow workspaces. This is a feature gap, not a design flaw.

---

## 0. Architecture Validation: Mono-Engine, Multi-TUI

### The Core Engine Model

The `markflow` engine is **mono-workflow**. `createRunManager(runsDir)` takes the full path to a runs directory (default `"./runs"`). It does NOT append `/runs` internally. All CLI commands follow the pattern:

```typescript
// packages/markflow/src/cli/commands/run.ts
runsDir: join(workspaceDir, "runs")
```

Every run created by the engine lives under this single directory. Multiple runs of the SAME workflow coexist here (timestamped subdirectories with `events.jsonl` + `meta.json` + `output/`).

### The TUI Model

The TUI manages **multiple workflows**, each with its own workspace:

| Entry Type | Workspace Resolution | Runs Directory |
|---|---|---|
| **File** (bare `.md`) | `<cwd>/.markflow-tui/workspaces/<slug>/` | `<workspace>/runs/` |
| **Workspace** (directory) | The directory itself | `<directory>/runs/` |

`resolveEntryWorkspace()` (`workspace.ts:72-88`) handles both cases. File entries get a collision-free slug via `fileSlug(absolutePath)` — `<stem>-<hash8>` using SHA-256 of the absolute path. The same file always maps to the same workspace, so multiple runs accumulate correctly.

### Why This Is Correct

- Different workflows produce different run artifacts and step output. Mixing them in one directory would make `listRuns()` return heterogeneous results.
- The engine's `meta.json` stores `workflowName` and `sourceFile` per run, but the directory-per-workflow model provides stronger isolation.
- Per-row `runsDir` on `RunsTableRow` (`runs/types.ts:93`) lets the runs table aggregate entries from different workspaces while preserving the back-pointer needed for `MODE_OPEN_RUN`.

### Data Flow for Run Creation

1. User presses `r` on a workflow in the browser
2. `startRunFromEntry()` (`app.tsx:451`) calls `resolveEntryWorkspace()` to get the per-workflow `{ workspaceDir, runsDir }`
3. `startRunForWorkflow()` opens the input modal (if inputs are declared) or calls `launchRun()` directly
4. `launchRun()` (`app.tsx:390`) calls the engine bridge with the workspace-scoped `runsDir`
5. The `onRunStart` callback adds a `RunsTableRow` with `runsDir: args.runsDir` to `sessionRuns`
6. `MODE_OPEN_RUN` dispatches with the per-workflow `runsDir`, stored in viewing mode state
7. `useEngineAdapter({ runsDir: viewingRunsDir })` subscribes to the correct per-workflow runs directory

This pipeline is correctly threaded throughout — each run knows which runs directory it belongs to.

---

## 1. Bug: `resolver.ts:298` — Wrong Argument to `createRunManager()`

**Severity: High** | **File:** `src/browser/resolver.ts:298`

```typescript
async function readLastRun(workspaceDir: string): Promise<LastRunInfo | null> {
  const runs: RunInfo[] = await createRunManager(workspaceDir).listRuns();
  //                                             ^^^^^^^^^^^^
  //                          Should be: join(workspaceDir, "runs")
```

`createRunManager()` expects the full path to the `runs/` directory. Passing the workspace root means it looks for `<workspaceDir>/<runId>/meta.json` instead of `<workspaceDir>/runs/<runId>/meta.json`. This causes `readLastRun()` to always return `null` (the `catch` swallows the error), so the workflow browser never shows last-run status for workspace entries.

### Fix

```typescript
const runs: RunInfo[] = await createRunManager(join(workspaceDir, "runs")).listRuns();
```

One-line fix. Import `join` is already present.

---

## 2. Gap: `effectiveEngineState` Discards Live Runs Map

**Severity: Medium** | **File:** `src/app.tsx:217-219`

```typescript
const effectiveEngineState: EngineState = engineState ?? (
  liveEngineState.activeRun ? liveEngineState : initialEngineState
);
```

This falls back to `initialEngineState` (empty Map, null activeRun) whenever `liveEngineState.activeRun` is null. In the multi-workspace model, this guard has two effects:

1. **In browsing mode:** `viewingRunsDir` is undefined, so the adapter has nothing to watch. `liveEngineState` is always empty. The fallback to `initialEngineState` is harmless — both are empty.

2. **In viewing mode:** The adapter subscribes to the per-workflow `runsDir` and populates `liveEngineState.runs` via the list watcher. `activeRun` is populated once the adapter finds and tails the specific run. **Between subscription and tail completion**, `activeRun` may be null while `runs` already has data. The guard discards this intermediate state.

The practical impact is minor for completed runs (the adapter quickly replays into `activeRun`). For viewing a workspace with many runs where the target run hasn't been located yet, there's a transient flash where the step table shows empty state.

### Fix

```typescript
const effectiveEngineState: EngineState = engineState ?? liveEngineState;
```

This is safe because `liveEngineState` starts as `initialEngineState` before the adapter emits anything, so the fallback behavior is identical at mount time.

---

## 3. Gap: Runs Table Aggregation Is Incomplete

**Severity: Medium** | **Design gap, not a bug**

The runs table (`app.tsx:735-741`) merges two sources:

```typescript
const runRows = useMemo(() => {
  const base = initialRunRows ?? [];     // from cli.tsx's one-shot listRuns(MARKFLOW_RUNS_DIR)
  const novel = sessionRuns.filter(...); // runs started in THIS session
  return [...base, ...novel];
}, [initialRunRows, sessionRuns]);
```

This means:
- **Shown:** Runs from `MARKFLOW_RUNS_DIR` (if set) + runs started this session
- **Not shown:** Historical runs from per-workflow workspace directories

For a user who has registered workflows A, B, C and run them in previous sessions, the runs table will only show runs from whichever single `MARKFLOW_RUNS_DIR` points to (often just one workflow's runs) plus this session's new runs. Runs from the other workflows' workspaces are invisible.

### Design Options

**Option A (scan at startup):** When the registry loads, iterate all resolved workspace entries and call `createRunManager(join(workspace, "runs")).listRuns()` for each. Merge all results into `initialRunRows` with per-row `runsDir`.

**Option B (live aggregation):** Subscribe to each registered workflow's runs directory via `runManager.watch()` and feed updates into `sessionRuns`. More complex but provides live updates.

**Option C (deferred):** Accept the current behavior for now. The runs table already works correctly for in-session runs. The workflow browser shows last-run status per entry (once bug #1 is fixed). This is a feature enhancement, not a regression.

---

## 4. E2E Test Failures — Root Causes

### 4.1 T0809: Help overlay (`?`) — CONSISTENT FAILURE

**Symptom:** `session.write("?")` does not open the help overlay.

**Root cause:** PTY input timing race. The `?` keystroke may arrive before the initial render has fully settled and all `useInput` handlers are wired. The in-process test passes because `ink-testing-library` processes input synchronously within the React render cycle.

**Fix:** Add a readiness gate before sending `?`. Wait for a specific, unique UI element (e.g., the keybar rendering `? Help`) rather than a generic text match.

### 4.2 T1006: Submit inputs starts a run — CONSISTENT FAILURE

**Symptom:** After filling the input form and pressing Enter, no run directory appears in `scratch.runsDir`.

**Root cause:** This is a **test bug**, not an app bug. The E2E scratch environment sets `MARKFLOW_RUNS_DIR` to a temp directory (`tmp.ts:68`). But when the TUI runs a workflow from the browser, `resolveEntryWorkspace()` creates the run in a per-workflow workspace under `<cwd>/.markflow-tui/workspaces/<slug>/runs/`, not in `MARKFLOW_RUNS_DIR`. The test checks `scratch.runsDir` — the wrong directory.

**Fix:** The test should check the workspace-scoped runs directory. Either:
- Inspect `<scratch.workspaceDir>/.markflow-tui/workspaces/*/runs/` for run artifacts
- Or set `MARKFLOW_WORKSPACE_DIR` to redirect workspace creation (note: the TUI currently doesn't read this env var — it would need to be wired)

### 4.3 T0300: RUNS mode column headers — CONSISTENT FAILURE

**Symptom:** `0 shown · 1 archived` — the pre-created run is archived by the default 24h policy.

**Root cause:** The test creates a run via `writeEventLog()` without setting a recent timestamp. The archive policy (`completeMaxAgeMs: 24h`) hides completions older than 24h. The fixture's timestamp is stale, so the run is immediately archived.

**Fix:** Set `startedAt` / `completedAt` to recent timestamps in the event log fixture. Alternatively, toggle archive visibility with `a` before asserting columns.

### 4.4 T0105: Invalid entry keybar — FLAKY

**Symptom:** `r Run` appears in the keybar for invalid workflows.

**Root cause:** The keybar fixture for workflows mode doesn't condition `r Run` on the selected workflow's validity. Per features.md `5.6 rule 5 ("Never show a key you can't press"), the binding's `when` guard should check selection state.

**Fix:** Add a `when` guard to `r Run` that checks if the selected workflow is valid.

### 4.5 T1015: Palette input not capturing text — FLAKY

**Symptom:** After `:`, the palette shows `:` (empty). Typed characters don't appear.

**Root cause:** Race between overlay mount and keystroke arrival. The test sends `:` and immediately types `run`. The palette's `useInput` handler may not be registered yet when `r`, `u`, `n` arrive. Characters hit the app-level handler which returns early at line 609 (`state.overlay !== null`), but the palette's handler hasn't mounted yet.

**Fix:** After sending `:`, wait for `COMMAND` (the palette mode pill) before typing. The current `waitForText(":")` matches too many things on screen.

### 4.6 T0805: Palette `:quit` — FLAKY

**Symptom:** `:quit` doesn't execute. Related to T1015.

**Fix:** Same as T1015 — wait for `COMMAND` before typing.

---

## 5. Testing Methodology Assessment

### 5.1 What the Tests Actually Cover

| Layer | Tests | What It Validates |
|-------|-------|-------------------|
| Pure logic (reducers, derive, sort, filter) | ~800 | Data transformations on synthetic inputs — correctly scoped |
| Components (ink-testing-library) | ~600 | Render output from injected props — correctly scoped |
| App integration (ink-testing-library) | ~200 | App behavior with test seams (engineState, initialRunRows, runWorkflow) |
| E2E (node-pty) | 87 | Real binary in a real PTY — the only layer that catches timing issues |

### 5.2 Test Seams Are Appropriate

The `engineState`, `initialRunRows`, and `runWorkflow` props on `<App>` are legitimate test seams. They allow the 200+ app integration tests to verify UI behavior (mode transitions, overlay lifecycle, keybar rendering, filter/sort/archive pipelines) without needing a real engine or filesystem. This is correct — these tests verify the React/Ink layer in isolation.

The E2E tests complement this by exercising the full stack. The 5 failures are real but bounded:
- 2 are test bugs (T1006 wrong dir, T0300 stale timestamp)
- 3 are PTY timing races (T0809, T1015, T0805) — real issues but specific to async input delivery

### 5.3 The Confidence Gap Is Narrower Than Initially Assessed

The first audit overstated the gap by misidentifying the multi-workspace model as a bug. With the correct understanding:
- The pure logic layer is well-tested and correct
- The component layer correctly tests rendering behavior
- The app integration layer correctly tests UI workflows via appropriate seams
- The E2E layer catches real timing and integration issues

The remaining blind spot is **cross-workspace aggregation** (gap #3 above) — but this is a feature not yet built, not a broken feature.

---

## 6. Feature Completeness vs. Spec

### Implemented and Working
- Workflow browser with registry persistence (add, list, preview, remove)
- Multi-workflow workspace isolation with collision-free slugs
- Mode navigation (WORKFLOWS -> RUNS -> RUN)
- Workflow resolution (file, workspace, URL materialisation)
- Run creation from the browser (with per-workflow workspace)
- Input prompt modal for workflows with declared inputs
- Live run viewing with step table and graph tab
- Viewing pane tabs (graph, detail, log, events)
- Runs table with sort/filter/archive pipeline
- Per-row runsDir tracking for multi-workspace aggregation
- Engine adapter subscription scoped to per-workflow runsDir in viewing mode
- Narrow-tier responsive layout
- ASCII/monochrome fallback
- Approval modal with auto-open and suppression
- Resume wizard modal
- Command palette with `:run`, `:quit`, `:approve`, `:resume`
- Help overlay

### Has a Bug
- **Workspace last-run status** — `resolver.ts:298` passes wrong path to `createRunManager()`, so last-run info is always null for workspace entries

### Feature Gaps (Not Yet Built)
- **Cross-workspace runs aggregation** — runs table only shows `MARKFLOW_RUNS_DIR` + session runs, not historical runs from all workflow workspaces
- **Run cancel** — palette returns `"cancel not yet wired"`
- **ASCII Mermaid overlay** — post-MVP
- **Run comparison/diff** — post-MVP
- **Saved filter views** — post-MVP

---

## 7. Rectification Plan

### Phase R1: Fix `resolver.ts:298` (Critical, 5 min)

```diff
- const runs: RunInfo[] = await createRunManager(workspaceDir).listRuns();
+ const runs: RunInfo[] = await createRunManager(join(workspaceDir, "runs")).listRuns();
```

Unblocks: workspace entries showing last-run status in the workflow browser.

### Phase R2: Fix `effectiveEngineState` Guard (Low effort, 5 min)

```diff
- const effectiveEngineState: EngineState = engineState ?? (
-   liveEngineState.activeRun ? liveEngineState : initialEngineState
- );
+ const effectiveEngineState: EngineState = engineState ?? liveEngineState;
```

Unblocks: live runs map visible during adapter startup transient.

### Phase R3: Fix E2E Test Assertions (Medium, 1-2 hours)

1. **T1006:** Change assertion to check the workspace-scoped runs directory instead of `scratch.runsDir`
2. **T0300:** Set recent timestamps in the event log fixture
3. **T0809, T1015, T0805:** Wait for specific UI elements (mode pills, overlay titles) before sending keystrokes. After `:`, wait for `COMMAND`; after `?`, wait for `HELP`.
4. **T0105:** Add `when` guard on `r Run` keybar binding conditioned on selected workflow validity

### Phase R4: Cross-Workspace Runs Aggregation (Feature, 4-6 hours)

When the registry loads, scan all resolved workspace entries and hydrate `initialRunRows` from each workspace's runs directory. Thread per-row `runsDir` so `MODE_OPEN_RUN` targets the correct workspace.

This can be incremental:
1. Add a `hydrateRunsFromRegistry()` function that iterates resolved entries and calls `listRuns()` per workspace
2. Merge results into the initial runs feed with per-row `runsDir`
3. Optionally add live watching via `runManager.watch()` per workspace

---

## 8. Summary of Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **High** | `createRunManager(workspaceDir)` should be `createRunManager(join(workspaceDir, "runs"))` | `resolver.ts:298` |
| 2 | **Medium** | `effectiveEngineState` discards live runs map when `activeRun` is null | `app.tsx:217-219` |
| 3 | **Medium** | Runs table only aggregates `MARKFLOW_RUNS_DIR` + session; missing cross-workspace historical runs | `app.tsx:735-741`, `cli.tsx:25-34` |
| 4 | **Medium** | E2E test T1006 checks wrong directory for run artifacts (test bug) | `test/e2e/` |
| 5 | **Medium** | E2E test T0300 uses stale timestamps; run is archived on arrival (test bug) | `test/e2e/` |
| 6 | **Low** | PTY timing races in E2E tests T0809, T1015, T0805 | `test/e2e/` |
| 7 | **Low** | Keybar shows `r Run` for invalid workflows (missing `when` guard) | keybar fixtures |
| 8 | **Info** | Cancel command not wired (`"cancel not yet wired"`) | `app.tsx:1257-1259` |
| 9 | **Info** | `MARKFLOW_WORKSPACE_DIR` set in E2E env but never read by app code | `test/e2e/tmp.ts:69` |

---

*End of audit. Phase R1 and R2 are 5-minute fixes. Phase R3 (E2E test corrections) is the highest-value next step for eliminating false failures. Phase R4 (cross-workspace aggregation) is a genuine feature enhancement.*
