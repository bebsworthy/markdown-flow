# markflow-tui — End-to-End Test Plan

> Purpose: a complete, exhaustive list of user-visible features, actions, and
> displays introduced by phases **P1 through P9**, each paired with the
> end-to-end test(s) that must exist to validate it against the real built
> binary (Layer-3 harness: `node-pty` + `@xterm/headless`, see
> `packages/markflow-tui/test/e2e/`).
>
> **Why this document exists.** Unit and component tests have passed all
> along while the actual binary was broken (`r` on a workflow did nothing on
> screen; `runsDir` was never wired; etc.). Tests that don't spawn the real
> binary against a real engine are not sufficient. Every row in this plan
> maps to at least one test that drives the built `dist/cli.js` in a PTY and
> asserts on the rendered screen plus on-disk state.
>
> **Scope.** Only P1–P9 surfaces. P15 (visual regression / VHS) is out of
> scope here — it is tracked separately.
>
> **ID scheme.** `T####` — four digits, monotonic, grouped by feature area.
> Leave gaps between groups so new tests can be inserted without renumbering.
>
> **Conventions.**
> - A test is complete (`[x]`) only when it runs in CI under
>   `npm run test:e2e -w packages/markflow-tui` and asserts on screen output
>   and/or on-disk artifacts (not just "did not crash").
> - Every test uses a per-test scratch env (`createScratchEnv()`) and
>   self-contained `.md` fixtures under `test/e2e/fixtures/`.
> - Every wait is bounded (no unbounded polling or hard `sleep`).
> - Fixtures are deterministic — no network calls at test time, no clocks,
>   no random ids except the engine's.
>
> **Prerequisites (all resolved as of 2026-04-17):**
> - **B1** — ✅ `markflow-tui` CLI accepts `--runs-dir` / `--workspace-dir`
>   (and `MARKFLOW_RUNS_DIR` / `MARKFLOW_WORKSPACE_DIR` env fallbacks);
>   `runsDir` is threaded into `<App>` via `cli.tsx`.
> - **B2** — ✅ Engine `run:start` event carries `runId`.
> - **B3** — Ink input dispatch respects `inputDisabled` on the core
>   consumers (browser, runs-table, overlays); a full audit is still
>   tracked under §17 below as cross-cutting e2e tests.

---

## Legend

- **Refs** — source section(s) the test derives from.
- **Layer** — `e2e` (PTY + built binary, the default) or `e2e-engine` (PTY
  harness that also seeds `runs/<id>/events.jsonl` on disk so the TUI
  attaches to a pre-existing run without actually running scripts).
- **Fixture** — the `.md` workflow or registry file used. Listed fixtures
  live under `packages/markflow-tui/test/e2e/fixtures/`.
- **Asserts on** — screen snapshot, substring presence, registry JSON,
  run directory, exit code, stderr.

---

## 1. Launch & process lifecycle  (P2, P4)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0001 | Starting `markflow-tui` with no args on an empty working dir renders the empty-state hint (§2 mockup) with the keybar reduced to `a Add · ? Help · q Quit`. | mockups.md §2 empty-state; features.md §3.1 | [x] |
| T0002 | `q` at the empty state exits cleanly (exit code 0, terminal restored, no stray output). | features.md §5.5 global | [x] |
| T0003 | `Ctrl-C` from any mode tears down the PTY and exits 130; no dangling child processes. | combray raw-mode discipline; features.md §6.2 | [x] |
| T0004 | `markflow-tui nonexistent.md` reports the resolve failure inline in the registry list with `✗` badge and does not crash. | mockups.md §2 | [x] |
| T0005 | `markflow-tui <dir-containing-.markflow.json>` registers the dir as a `[workspace]` entry. | features.md §3.1 launch | [x] |
| T0006 | `markflow-tui <glob>` (e.g. `fixtures/*.md`) registers each resolved file once. | features.md §3.1 launch | [x] |
| T0007 | Re-launching with the same positional arg is idempotent — registry file contains one entry, not duplicates. | features.md §3.1 persistence | [x] |
| T0008 | `--no-save` launch does not write `./.markflow-tui.json`; entries live for the session only. | features.md §3.1 launch | [x] |
| T0009 | `--list <path>` reads/writes the alternate list file. | features.md §3.1 launch | [x] |
| T0010 | A SIGWINCH during startup does not corrupt the first render (regression for Ink alt-screen race). | features.md §6.2 | [x] |
| T0011 | Non-TTY stdout (`markflow-tui <<<""`) prints a guidance message and exits non-zero; does not attempt to mount Ink. | features.md §6.4 | [x] |
| T0012 | `NO_COLOR=1` disables colored output; monochrome theme applied to shell, keybar, and modals. | features.md §5.10; mockups.md §14 | [x] |
| T0013 | `MARKFLOW_ASCII=1` (or `--ascii`) swaps glyphs for bracketed text states and box-drawing for `+-|`. | features.md §5.10; mockups.md §14 | [x] |

## 2. Workflow browser  (P4-T1/T2)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0100 | With ≥1 entry, the browser renders title, source badge (`[file]`/`[workspace]`), last-run status, and diagnostics flag for each row (§2 mockup). | mockups.md §2 | [x] |
| T0101 | `↑`/`↓` + `j`/`k` moves the cursor; the preview pane updates to the selected workflow on each move. | mockups.md §2 | [x] |
| T0102 | `g` jumps to top, `G` to bottom. | features.md §5.5 | [x] |
| T0103 | A parse-failing entry renders in the list with `✗ parse` and stays visible (hide-don't-delete). Cursor can still land on it. | features.md §3.1; mockups.md §2 | [x] |
| T0104 | Preview pane for a valid workflow shows `# Title`, `## Inputs`, `## Flow` ascii digest, and `N steps · K approvals · B forEach` summary. | mockups.md §2 | [x] |
| T0105 | Preview pane for an invalid entry shows diagnostic lines verbatim and hides the Run keybar binding. | features.md §5.6 rule 5 | [x] |
| T0106 | `Enter` on a valid entry drills into the run list filtered to that workflow (or opens the preview pane — spec-exact behaviour per mockups.md §2). | mockups.md §2 | [x] |
| T0107 | `d` on a valid entry removes the entry from the registry file but does NOT touch the underlying `.md` or workspace directory on disk. | features.md §3.1 | [x] |
| T0108 | `e` on a valid entry is accepted (may be a no-op today) without corrupting state; cursor stays on the same entry. | mockups.md §2 keybar | [x] |
| T0109 | Registry file is atomically replaced on every mutation — a `kill -9` during write never leaves a truncated JSON file. | features.md §3.1 persistence | [x] |
| T0110 | Empty-state hint (§2 empty mockup) appears exactly when the registry is empty and the launch command had no positional args. | mockups.md §2 empty | [x] |

## 3. Add workflow modal  (P4-T3)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0200 | `a` opens the add modal with `[ Fuzzy find ]  Path or URL` tabs and an empty input (§2 mockup). | features.md §3.1 adding; mockups.md §2 add-modal | [ ] |
| T0201 | Fuzzy-find tab lists `.md` files under the current root, filtered to workflows that parse (plus `✗ parse` rows, but no random `.md`). | features.md §3.1 fuzzy | [ ] |
| T0202 | Fuzzy-find ranks matches by fuzzysort score; typing incrementally narrows the list within 100 ms of keystroke. | features.md §6.1 | [ ] |
| T0203 | `Ctrl+Up` moves the fuzzy-find root and re-indexes — any absolute path is accepted, no disk restriction. | features.md §3.1 fuzzy | [ ] |
| T0204 | `Tab` switches between the Fuzzy find and Path or URL tabs; focus moves to the other input. | mockups.md §2 add-modal | [ ] |
| T0205 | Path tab accepts absolute paths, relative paths, and glob patterns; each resolved match becomes one registry entry. | features.md §3.1 | [ ] |
| T0206 | URL tab rejects non-`http(s)://` input with an inline error; `Enter` is disabled (hide-don't-grey: button omitted). | features.md §3.1 | [ ] |
| T0207 | URL tab on a valid URL materialises a workspace on the local scratch env and registers it as `[workspace]` (network mocked via a local static file server fixture). | features.md §3.1 URL flow | [ ] |
| T0208 | `Esc` closes the modal without adding anything; registry file is unchanged. | mockups.md §2 add-modal | [ ] |
| T0209 | `Enter` on the selected fuzzy result persists the entry and closes the modal; the new entry is selected in the browser. | features.md §3.1 | [ ] |
| T0210 | Adding a path that is already in the registry is a no-op; no duplicate entry is written. | features.md §3.1 | [ ] |

## 4. Runs table / Runs mode  (P5-T1/T2/T3)

Uses an `e2e-engine` fixture that pre-seeds `runs/<id>/events.jsonl` files so
the TUI attaches to several historical runs without actually executing
scripts — deterministic and fast.

| ID | Test | Refs | Status |
|---|---|---|---|
| T0300 | `F2` (or `2`) switches to RUNS mode; the runs-table renders the expected columns (`ID · WORKFLOW · STATUS · STEP · ELAPSED · STARTED · NOTE`). | mockups.md §1, §12; features.md §3.2 | [ ] |
| T0301 | Default sort is "attention" — active (`▶`/`⏸`) first by `started` desc, then terminal (`✗`/`✓`) by `ended` desc. | features.md §3.2; mockups.md §1 | [ ] |
| T0302 | `s` cycles sort columns (`started`, `ended`, `duration`, `workflow`, `status`); the header indicator moves and rows reorder. | features.md §3.2 | [ ] |
| T0303 | Archive default hides terminal runs older than 24 h (ok) / 7 d (failed); footer reads `N shown · M archived`. | features.md §3.2 | [ ] |
| T0304 | `a` toggles archive visibility; table size grows/shrinks accordingly. | features.md §3.2 | [ ] |
| T0305 | `/` opens the filter input; typing `status:running` narrows the table to running rows. | features.md §3.2 | [ ] |
| T0306 | Filter supports `workflow:<name>`, `since:<duration>`, free-text id prefix. | features.md §3.2 | [ ] |
| T0307 | `n` / `N` jumps to next / previous filter match (P9-T6 scope). | features.md §3.2 | [ ] |
| T0308 | `g`/`G` jump to top/bottom respect the current filter view. | features.md §5.5 | [ ] |
| T0309 | Cursor follow-selection: moving the cursor updates the bottom tabbed pane live (wide tier). | mockups.md §1 | [ ] |
| T0310 | Status badge glyphs match the table in §1 (`▶`, `⏸`, `✗`, `✓`, `○`) with paired color. | features.md §5.10 | [ ] |
| T0311 | `r Resume (N)` keybar count reflects the number of suspended rows; vanishes when N=0 (hide-don't-grey). | mockups.md §1, §3 | [ ] |
| T0312 | Virtualised render: opening a 10 000-row runs table paints the first frame in <500 ms and scrolling with `j` does not recompute off-screen rows. | features.md §3.2 | [ ] |
| T0313 | `Enter` on a terminal (complete/error) row opens the zoomed run viewer (RUN mode); keybar flips from RUNS to RUN. | mockups.md §1, §4, §6 | [ ] |
| T0314 | `q` inside RUN mode returns to RUNS mode (not all the way out). | mockups.md §15 | [ ] |

## 5. Run viewer — step table  (P6-T1)

Zoomed view of one run; `e2e-engine` pre-seeds events representative of
each status.

| ID | Test | Refs | Status |
|---|---|---|---|
| T0400 | Opening a mid-run run shows the step table with the exact columns in §4 mockup (`STEP · STATUS · ATTEMPT · ELAPSED · NOTE`). | mockups.md §4 | [ ] |
| T0401 | Parent/child indentation under a fan-out: `fan-out` at depth 0, `deploy-us` / `deploy-eu` at depth 1. | mockups.md §4 | [ ] |
| T0402 | `⟳ batch [regions]` row renders under its parent with progress `N/M` and an ascii bar `████░░░`. | features.md §3.3 | [ ] |
| T0403 | Retrying step shows `↻ retrying · delay <s>` in NOTE; countdown decreases live. | features.md §3.9 | [ ] |
| T0404 | Timeout step shows `⏱ <elapsed>/<limit>` and auto-transitions to `✗` on `step:timeout`. | features.md §3.9 | [ ] |
| T0405 | Retry-exhausted step shows `retries exhausted · edge: fail:max` in NOTE (mockup §6). | mockups.md §6 | [ ] |
| T0406 | `↑`/`↓` moves the step cursor; header right-aligned status updates (`<step> · script · seq=<n>`). | mockups.md §4 | [ ] |
| T0407 | Skipped upstream surfaces as `○ skipped · upstream failed`. | mockups.md §6 | [ ] |
| T0408 | Em-dash `—` in columns that do not yet apply to a pending row. | mockups.md §4 | [ ] |
| T0409 | Header line shows run id, workflow name, status glyph, "started Xm ago", and retry-budget summary. | mockups.md §4, §6 | [ ] |

## 6. Tabbed pane — Graph / Detail / Log / Events  (P6-T2/T3/T4)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0500 | `1`/`2`/`3`/`4` cycle Graph / Detail / Log / Events tabs; the active tab is rendered in brackets (`[ Graph ]`). | mockups.md §1, §4 | [ ] |
| T0501 | `Tab` (no modifier) advances to next tab; `Shift-Tab` reverses (P9-T6 scope). | features.md §5.5 | [ ] |
| T0502 | Graph tab renders an indented DAG using the same tree as the step table, with per-token glyphs. | features.md §3.3; mockups.md §1 | [ ] |
| T0503 | Detail tab for a running step shows type (script/agent/approval), config, templated prompt/script body, resolved env, upstream edge, and last log line. | features.md §3.4; mockups.md §4 | [ ] |
| T0504 | Detail tab for a complete step shows `summary`, `edge`, `exit`, `local`, `global`, `started`, `ended`. | features.md §3.4; mockups.md §6 | [ ] |
| T0505 | Detail tab for a failed step shows last 3 `stderr` lines with `(… for full log)` hint. | mockups.md §6 | [ ] |
| T0506 | Log tab defaults to follow mode with `⏵` right-edge indicator; live `step:output` appends within 100 ms. | features.md §3.5; mockups.md §8 | [ ] |
| T0507 | Scrolling up with `k` / PgUp auto-pauses follow; yellow "PAUSED — press F to resume" banner appears; new-lines counter increments live. | features.md §3.5; mockups.md §9 | [ ] |
| T0508 | `F` resumes follow; banner clears; cursor jumps to the tail. | mockups.md §9 | [ ] |
| T0509 | `G` jumps to log head (live tail); `g` jumps to log top (seq=1). | mockups.md §9 | [ ] |
| T0510 | `1` / `2` / `3` filter stdout / stderr / both; stderr lines bold-red. | features.md §3.5 | [ ] |
| T0511 | `w` toggles line wrap; long lines wrap to the pane width with a continuation marker. | features.md §3.5 | [ ] |
| T0512 | `t` toggles timestamps; seq column stays visible regardless. | features.md §3.5 | [ ] |
| T0513 | `/` starts search; `n` / `N` jump between highlights; matched substrings highlighted. | features.md §3.5 | [ ] |
| T0514 | Log tab reads from sidecar files on demand — opening a 50 MB sidecar doesn't OOM the process (ring buffer + lazy seek). | features.md §3.5; §6.2 | [ ] |
| T0515 | Events tab renders one line per `EngineEvent` with `seq · type · key fields`. | mockups.md §1 (tab group) | [ ] |
| T0516 | Events tab updates live as new events append; `Enter` on an event jumps the step/log views to that `seq`. | mockups.md §1 | [ ] |

## 7. Approval flow  (P7-T1)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0600 | A `step:waiting` event on the viewed run auto-opens the approval modal with prompt + options (mockup §5). | features.md §3.6; mockups.md §5 | [ ] |
| T0601 | Mode pill `[APPROVAL]` renders in reverse-video in the keybar. | features.md §5.6 rule 8 | [ ] |
| T0602 | `↑` / `↓` (or `j`/`k`) moves radio focus `◉` / `○`; `Enter` decides. | mockups.md §5 | [ ] |
| T0603 | Submitting a decision fires `executeWorkflow({ resumeFrom, approvalDecision })`; `approval:decided` event arrives; modal closes; tree continues. | features.md §3.6 | [ ] |
| T0604 | Double-`Enter` submits only once (FSM guard). | features.md §3.6 (XState) | [ ] |
| T0605 | `s Suspend-for-later` closes the modal; run remains `suspended` in `runs/` (verify `status` on disk). | features.md §3.6 | [ ] |
| T0606 | `Esc` closes the modal without deciding and without suspending; the keybar returns to RUN mode. | mockups.md §5 | [ ] |
| T0607 | Background content is visually dimmed while the modal is open (theme-driven dim, not hardcoded). | mockups.md §5, §10 | [ ] |
| T0608 | Pressing `a` on a suspended run from the RUNS table opens the same approval modal in-place. | mockups.md §3 | [ ] |
| T0609 | If the engine reports the node no longer exists or is already decided, the modal closes and a status message explains why. | features.md §3.6 | [ ] |

## 8. Resume wizard  (P7-T2)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0700 | `R` (uppercase) in the run viewer of a terminal-failed run opens the resume wizard with the failing node preselected `[x]`. | features.md §3.8; mockups.md §7 | [ ] |
| T0701 | Mode pill `[RESUME]`; keybar `⏎ Resume · Space Toggle · Tab Next · p Preview · Esc`. | mockups.md §7 | [ ] |
| T0702 | `Space` toggles the `[ ]` / `[x]` for the focused node row. | mockups.md §7 | [ ] |
| T0703 | `Tab` / `Shift-Tab` cycles the focus between `--rerun` checkboxes, each input field, and the Resume button. | mockups.md §7 | [ ] |
| T0704 | Edited inputs show `← edited` annotation before confirmation. | mockups.md §7 | [ ] |
| T0705 | `Enter` submits, appends `run:resumed` to the same `events.jsonl`, closes the wizard, and switches to the live run viewer. | features.md §3.8 | [ ] |
| T0706 | `Esc` closes the wizard without side effects. | mockups.md §7 | [ ] |
| T0707 | `p` opens the Preview-events overlay (non-MVP placeholder allowed, but must not crash). | mockups.md §7 | [ ] |
| T0708 | Resume fails with `RunLockedError` (another process holds `.lock`) — the wizard stays mounted and surfaces "Run is locked — retry" in-modal. | features.md §7; P7-T2 | [ ] |
| T0709 | Resume with a schema mismatch (`WorkflowChangedError`) surfaces a named error banner, does not append events, and leaves the wizard open. | features.md §3.8 | [ ] |
| T0710 | Opening the wizard on a currently-running run is disallowed (hide-don't-grey: `R` is not in the keybar). | features.md §5.6 rule 5 | [ ] |

## 9. Command palette & help  (P7-T3)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0800 | `:` opens the command palette; `[COMMAND]` pill appears; background dimmed. | features.md §3.10; mockups.md §10 | [ ] |
| T0801 | Typing `:re` filters the command list to `:resume`, `:rerun`, `:reload`, `:restart`; first match pre-selected. | mockups.md §10 | [ ] |
| T0802 | `Tab` completes the common prefix of the filtered commands. | mockups.md §10 | [ ] |
| T0803 | `Enter` executes the selected command with its argument. | features.md §3.10 | [ ] |
| T0804 | `Esc` closes the palette without executing; any typed text is discarded. | mockups.md §10 | [ ] |
| T0805 | `:quit` exits the TUI cleanly. | features.md §3.10 | [ ] |
| T0806 | `:goto <seq>` jumps the log pane to that `seq` if present; otherwise shows an inline error. | features.md §3.10 | [ ] |
| T0807 | `:theme <name>` switches theme at runtime (if the feature is in MVP scope) or reports `unknown theme`. | features.md §3.10 | [ ] |
| T0808 | Unknown command → inline `unknown command` message, palette stays open. | features.md §3.10 | [ ] |
| T0809 | `?` opens the help overlay with categories `RUN`, `VIEW`, `GLOBAL` and only the active bindings for the current (mode, focus). | features.md §3.10; mockups.md §11 | [ ] |
| T0810 | `/` inside help filters rows to matches; keys bold-highlighted. | mockups.md §11 | [ ] |
| T0811 | Disabled bindings (e.g. `a Approve` when no approvals pending) are **omitted** from the help overlay, not greyed. | features.md §5.6 rule 5; mockups.md §11 | [ ] |
| T0812 | `Esc` closes the help overlay; focus returns to the pane/modal that was active before `?`. | mockups.md §11 | [ ] |

## 10. Keybar — responsive tiers & mode pills  (P3-T4, P8)

| ID | Test | Refs | Status |
|---|---|---|---|
| T0900 | At ≥100 cols the keybar renders the "full" row per §15 matrix for the current mode (exact strings). | mockups.md §15 | [ ] |
| T0901 | At 60–100 cols the keybar collapses to the "short" row per §15. Column-drop order matches §12. | mockups.md §12, §15 | [ ] |
| T0902 | At <60 cols the keybar is keys-only with the right-side `? for labels` hint (§13). | mockups.md §13, §15 | [ ] |
| T0903 | Mode pill `[APPROVAL]` / `[RESUME]` / `[COMMAND]` / `[HELP]` renders in reverse video only during the matching overlay. | features.md §5.6 rule 8 | [ ] |
| T0904 | Toggle labels flip between states (`Follow ↔ Unfollow`, `Wrap ↔ NoWrap`) when the feature flips. | features.md §5.6 rule 6 | [ ] |
| T0905 | Destructive actions (`X Cancel`, `D Deny`) render in the theme's destructive color. | features.md §5.6 rule 4 | [ ] |
| T0906 | A terminal resize event (SIGWINCH) re-computes tiers live; the keybar switches from "full" to "short" mid-session without a restart. | features.md §6.2 | [ ] |
| T0907 | Hide-don't-grey: bindings whose `when(ctx)` is false never appear, regardless of tier. | features.md §5.6 rule 5 | [ ] |
| T0908 | Shared-modifier extraction: `Ctrl + <n|p|t>` renders as a single group, not three `Ctrl +` repeats. | features.md §5.6 | [ ] |

## 11. Run entry  (P9-T1)

**Blocker B1 must be resolved before these tests can pass.**

| ID | Test | Refs | Status |
|---|---|---|---|
| T1000 | `r` on a workflow with zero declared inputs starts a run immediately; the TUI transitions to `viewing` mode within 300 ms of the engine's `run:start`; the run appears in `runs/<id>/events.jsonl`. | features.md §3.1, §5.7 | [ ] |
| T1001 | `r` on a workflow with ≥1 required input opens the input-prompt modal (mockup §4.3 of P9-T1 plan). Title reads `RUN · <workflow>`. | features.md §5.7 | [ ] |
| T1002 | The `⏎ Run` button is dimmed (hidden label) until every required input is populated. | P9-T1 plan §6 D4 | [ ] |
| T1003 | `Tab` / `Shift-Tab` cycles focus between input rows; `Enter` on a non-final row advances when submit is still blocked. | P9-T1 plan §6 D4 | [ ] |
| T1004 | Typing into a row updates the draft live; backspace deletes. Rapid keystrokes do not clobber each other (ref-tracked drafts). | P9-T1 plan §6 D5 | [ ] |
| T1005 | `Esc` cancels the modal; the bridge is NOT called; registry / runs dir unchanged. | P9-T1 plan | [ ] |
| T1006 | Submitting valid inputs calls the engine bridge; `run:start` fires with the inputs; the modal closes exactly once. | P9-T1 plan | [ ] |
| T1007 | Bridge returning `{kind:"locked", …}` keeps the modal open with "Run is locked — retry" surfaced in-modal. | features.md §7; P9-T1 plan | [ ] |
| T1008 | Bridge returning `{kind:"invalidInputs", missing}` surfaces the missing keys in-modal and returns focus to the first missing row. | P9-T1 plan | [ ] |
| T1009 | Bridge returning `{kind:"parseError", message}` surfaces the engine's message verbatim; modal stays mounted. | P9-T1 plan | [ ] |
| T1010 | `:run <name>` palette command matches the registered workflow by exact name, then by unique prefix; ambiguous prefix → `usage: ambiguous: matches a, b`. | P9-T1 plan | [ ] |
| T1011 | `:run <unknown>` → `unavailable: no workflow matching '<unknown>'` inline in the palette. | P9-T1 plan | [ ] |
| T1012 | `:run <name>` on a workflow with required inputs opens the same input-prompt modal. | P9-T1 plan | [ ] |
| T1013 | `r` on a Runs-table row with a terminal (`complete` / `error`) status re-launches the same workflow with an empty input set (hide-don't-grey: `r` absent when the row is still active). | P9-T1 plan | [ ] |
| T1014 | `r` is a silent no-op on an active row; no modal, no error. | features.md §5.6 rule 5 | [ ] |
| T1015 | With the palette open, the browser's `r` binding does not also fire on the `r` character of `:run` — no double-dispatch. | B3 audit | [ ] |

## 12. Cancel live run  (P9-T2)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1100 | `X` on a running run opens the `confirm-cancel` overlay with the run id and workflow name. | features.md §3.8; mockups.md §1 | [ ] |
| T1101 | Mode pill `[CONFIRM]` (or equivalent); destructive color on the "Cancel run" button. | features.md §5.6 rule 4 | [ ] |
| T1102 | `y` / `Enter` on the destructive button aborts the run via `signal.abort()`; `workflow:error` is emitted; status flips to `error` on disk. | features.md §2.6 | [ ] |
| T1103 | `n` / `Esc` closes the overlay without cancelling; run continues. | features.md §3.8 | [ ] |
| T1104 | `X` is hidden (not greyed) when the focused row is already terminal. | features.md §5.6 rule 5 | [ ] |
| T1105 | Cancelling a detached run (started by another process) fails gracefully with an inline message ("process-local cancel only"). | features.md §7 | [ ] |

## 13. Pending-approvals surface  (P9-T3)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1200 | A file-watch on `runs/*/meta.json` flipping to `suspended` surfaces a status-bar badge `⏸ N waiting` within 500 ms. | features.md §3.7; §7 | [ ] |
| T1201 | `:pending` (or `P`) opens a cross-run pending-approvals table with the same columns as `markflow pending`. | features.md §3.7 | [ ] |
| T1202 | `Enter` on a row in the pending table opens that run's viewer with the approval modal auto-mounted. | features.md §3.7 | [ ] |
| T1203 | Badge count updates when an external `markflow approve` resolves a pending decision. | features.md §3.7 | [ ] |
| T1204 | File-watch is torn down on quit; no orphan watchers. | features.md §6.2 | [ ] |

## 14. Retry budget visibility  (P9-T4)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1300 | Graph tab renders a small bar next to edge labels showing `retryBudgets.get("node:label")` as `N/M`. | features.md §3.9; mockups.md §4 header | [ ] |
| T1301 | `retry:increment` events update the bar in place without a full re-render. | features.md §3.9 | [ ] |
| T1302 | `retry:exhausted` flips the bar to the theme's destructive color and links to the exhaustion handler node. | features.md §3.9 | [ ] |
| T1303 | Run header line shows a budget summary `retry budgets: <node> N/M · …` matching mockup §4. | mockups.md §4, §6 | [ ] |

## 15. `<Static>` rendering & performance  (P9-T5)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1400 | A run with 500 completed steps does not re-render the completed rows on each new event (observe frame count via the PTY byte stream). | features.md §6.2; Ink 3 release notes | [ ] |
| T1401 | Scrolling past 200 log lines never re-sends bytes for lines above the visible viewport (virtualisation check). | features.md §6.2 | [ ] |

## 16. Navigation ergonomics  (P9-T6)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1500 | `Tab` cycles focus through the visible panes (top table → tabbed pane → keybar); `Shift-Tab` reverses. | features.md §5.5 | [ ] |
| T1501 | `n` / `N` jump to next / prev filter match in the runs table and in the log pane. | features.md §3.2, §3.5 | [ ] |
| T1502 | `Esc` always pops exactly one level (overlay → mode → runs → quit-prompt) — never a full exit from a deep stack. | features.md §5.4 | [ ] |
| T1503 | Breadcrumb in narrow tier updates on every navigation; `Runs › <id> › <step>`. | mockups.md §13 | [ ] |

## 17. Input dispatch discipline  (cross-cutting; B3)

These tests guard against the class of bug where Ink broadcasts keystrokes
to every mounted `useInput` consumer.

| ID | Test | Refs | Status |
|---|---|---|---|
| T1600 | With the command palette open, typing `run deploy` into the palette does NOT also trigger the browser/runs-table `r` handler. | P9-T1 post-mortem | [ ] |
| T1601 | With the approval modal open, the runs-table `r` / `X` handlers are inert. | features.md §5.6 rule 5 | [ ] |
| T1602 | With the help overlay open, no underlying pane handler fires on any keystroke except `Esc` or `q`. | features.md §3.10 | [ ] |
| T1603 | With the resume wizard open, typing numeric characters in the inputs does NOT switch tabs. | features.md §3.8 | [ ] |
| T1604 | With the input-prompt modal open, the browser `r` handler is inert. | P9-T1 post-mortem | [ ] |
| T1605 | Every `useInput` site in `packages/markflow-tui/src/` receives an `inputDisabled` or equivalent gate; enforced by an AST check. | §7 B3 | [ ] |

## 18. Theming, monochrome, ASCII fallback  (P8-T2)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1700 | `NO_COLOR=1` renders the full app (shell, keybar, overlays, modals) without ANSI SGR color; status is carried by glyphs and text labels alone. | features.md §5.10 | [ ] |
| T1701 | `MARKFLOW_ASCII=1` replaces box-drawing with `+-|` and glyphs with bracketed text `[run] [ok] [fail] [wait]`. | features.md §5.10; mockups.md §14 | [ ] |
| T1702 | Auto-detection: `TERM=dumb` (or cp437) triggers the ASCII fallback without the env var. | mockups.md §14 | [ ] |
| T1703 | Disabling color does not change the layout — widths, line counts, and mockup snapshots remain comparable. | mockups.md §14 | [ ] |

## 19. Engine integration  (P1-T1…T5)

These exercise the public-API additions made by P1 against the running
binary. Uses `e2e-engine` layer (seed events on disk + attach).

| ID | Test | Refs | Status |
|---|---|---|---|
| T1800 | `runManager.watch()` fires a `run-added` event within 500 ms of an external `markflow run` creating a new run dir; the TUI reflects the new row. | features.md §7; P1-T4 | [ ] |
| T1801 | Concurrent-resume lock: starting a second TUI on the same `runsDir` and pressing `R` on the same run yields a `RunLockedError` in the wizard; the first TUI's run continues uninterrupted. | features.md §7; P1-T5 | [ ] |
| T1802 | `tailEventLog` streams events from an externally-started run that the TUI attaches to via `:attach <id>` (or equivalent UX). | features.md §7; P1-T3 | [ ] |
| T1803 | Sidecar resolver: opening the log tab for a historical run reads from `runs/<id>/output/<seq>-<node>.stdout.log` lazily. | features.md §7; P1-T2 | [ ] |
| T1804 | Graph helpers (`getTerminalNodes`, `getUpstreamNodes`, `isMergeNode`) drive the indented tree — merge nodes render the "waiting-for-upstream" indicator. | features.md §7; P1-T1 | [ ] |
| T1805 | `run:start` event carries `runId`; TUI's `onRunStart` fires during the first `onEvent` callback, not after `executeWorkflow` resolves. | fix commit `a983bff` | [ ] |

## 20. Registry persistence  (P4-T1)

| ID | Test | Refs | Status |
|---|---|---|---|
| T1900 | Add → crash before next write — registry file is intact with the single add applied (atomic write). | features.md §3.1 | [ ] |
| T1901 | Concurrent TUI instances on the same list file never corrupt it (last-write-wins is acceptable; partial writes are not). | features.md §3.1 | [ ] |
| T1902 | Registry file permissions are user-only (`0600`) when the TUI creates it. | features.md §3.1 | [ ] |
| T1903 | A manually edited registry file with invalid JSON triggers a recoverable error screen with "open in $EDITOR" guidance; TUI does not crash. | features.md §3.1 | [ ] |

## 21. Crash & exit discipline  (cross-cutting)

| ID | Test | Refs | Status |
|---|---|---|---|
| T2000 | Uncaught exceptions restore cooked TTY mode; no raw-mode leak. | features.md §6.2 | [ ] |
| T2001 | Exit code 0 on `q`; non-zero on `:quit!` forcing a failure (if such semantics exist); 130 on SIGINT. | features.md §3.10 | [ ] |
| T2002 | `stderr` is empty on a clean exit (no stray framework warnings, no React devtools noise). | features.md §6.2 | [ ] |

---

## Appendix A — Harness gaps (all resolved 2026-04-17)

1. ~~**`--runs-dir` / `--workspace-dir` flags on `markflow-tui`.**~~ ✅ Done.
   `parseRegistryFlags` now accepts `--runs-dir <path>` and
   `--workspace-dir <path>` (plus `=value` form) and falls back to the
   `MARKFLOW_RUNS_DIR` / `MARKFLOW_WORKSPACE_DIR` env vars. `cli.tsx`
   threads `runsDir` into `<App>`. Unblocks §11 onwards.
2. ~~**Shared PTY waiters.**~~ ✅ Done. `TuiSession` now exposes
   `snapshotContains(regex)`, `waitForRegex(regex, ms?)`, and
   `waitForEventLog(runId, minSeq, ms?)`. The last reads
   `<runsDir>/<runId>/events.jsonl` under a bounded poll loop and returns
   the parsed event array — event-driven tests bind to engine state, not
   visual timing.
3. ~~**Registry test seam.**~~ ✅ Done. `ScratchEnv` now has
   `writeRegistry(entries)` that writes the registry file synchronously
   before `spawnTui` is called. `addedAt` defaults to
   `2026-01-01T00:00:00Z` when omitted.
4. ~~**Event-log fixture builder.**~~ ✅ Done.
   `test/e2e/fixtures/event-log.ts` exposes `writeEventLog(runsDir, spec)`
   and `writeEventLogs(...)` — callers pass a compact
   `{ runId, workflowName, sourceFile, inputs?, events[] }` shape; the
   helper stamps `seq`/`ts` and writes both `events.jsonl` and a minimal
   `meta.json`.
5. ~~**Snapshot canonicaliser.**~~ ✅ Done. `canonicalize()` now also
   masks full ISO-8601 timestamps (`<ts>`), labelled run ids
   (`run <runid>` / `id <runid>` / `#<runid>`), compound durations
   (`1h2m`, `3m45s`), ISO-8601 durations (`PT1M30S`), and sub-second
   HH:MM:SS.mmm forms. Masks run ordered so UUID never collides with
   short-hex.

## Appendix B — Status summary

Update this table after each test lands.

| Group | Total | Done |
|---|---|---|
| 1 Launch & lifecycle | 13 | 13 |
| 2 Workflow browser | 11 | 11 |
| 3 Add modal | 11 | 0 |
| 4 Runs table | 15 | 0 |
| 5 Step table | 10 | 0 |
| 6 Tabbed pane | 17 | 0 |
| 7 Approval | 10 | 0 |
| 8 Resume wizard | 11 | 0 |
| 9 Palette & help | 13 | 0 |
| 10 Keybar tiers | 9 | 0 |
| 11 Run entry (P9-T1) | 16 | 0 |
| 12 Cancel (P9-T2) | 6 | 0 |
| 13 Pending (P9-T3) | 5 | 0 |
| 14 Retry budget (P9-T4) | 4 | 0 |
| 15 Static rendering (P9-T5) | 2 | 0 |
| 16 Nav ergonomics (P9-T6) | 4 | 0 |
| 17 Input dispatch | 6 | 0 |
| 18 Theming | 4 | 0 |
| 19 Engine integration | 6 | 0 |
| 20 Registry | 4 | 0 |
| 21 Exit discipline | 3 | 0 |
| **Total** | **180** | **24** |

---

*End of plan. Cross-references: `docs/tui/plan.md` (phase roster),
`docs/tui/features.md` (rationale), `docs/tui/mockups.md` (visual contract),
`docs/tui/testing.md` (test-layer strategy),
`packages/markflow-tui/test/e2e/README.md` (harness).*
