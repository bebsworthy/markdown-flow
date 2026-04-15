# markflow TUI — Features & UX Proposal

> Status: **design proposal / research synthesis**. No code yet.
> Purpose: ground the TUI design in (a) what the markflow engine actually exposes today, (b) the pain points of the existing CLI, and (c) evidence-based best practices from best-in-class TUIs.

---

## 1. Overview & Goals

**markflow** is a workflow engine that treats a single Markdown file as both documentation and executable spec (Mermaid flowchart = topology, fenced code / prose = steps). Runs are event-sourced, support fan-out/fan-in parallel execution, approval gates, step- and edge-level retries, timeouts, and suspend/resume.

The existing CLI (`init`, `run`, `ls`, `show`, `pending`, `approve`, `resume`, `debug`) is complete for one-shot operations but forces users to juggle multiple commands across a run's lifecycle — especially for approval gates (suspend → separate `approve` command) and for navigating multi-file sidecar transcripts.

### Goals

1. **Single-screen control plane** for authoring, running, observing, and recovering markflow runs.
2. **Live visibility** into parallel execution (fan-out/fan-in, retries, approvals) without `--verbose` noise.
3. **Inline approvals** — decide without leaving the TUI.
4. **Scriptable / CI-safe fallbacks** — the TUI is a superset of, not a replacement for, the existing CLI.

### Non-goals (for MVP)

- Workflow authoring/editing (Markdown editing stays in the user's editor).
- Web UI, mouse-driven UI, cross-host run management.
- Replacing the CLI's `--json` output or programmatic API.

### Packaging — CLI and TUI are separate

The TUI **is not bundled into the `markflow` CLI**. It ships as a sibling package, `markflow-tui`, in the same monorepo (npm workspaces) and depends on `markflow` as a runtime library via its public API (`src/core/index.ts`). This keeps the CLI lean — no Ink, React, or terminal-UI deps in environments that only need `markflow run` (CI boxes, Lambda, Docker images). Users opt in with `npm i -g markflow-tui`; invocation is `markflow-tui <args>`, not `markflow-tui`. See §6.5 for the distribution split and §7 for the firm public-API contract this implies.

### Who it's for

- **Workflow authors** iterating on a Markdown/Mermaid spec — want fast feedback on `run`, DAG visualization, per-step output.
- **Operators** watching long-running runs or handling approvals — want a live dashboard and inline decision UI.
- **Debuggers** investigating failures — want quick access to the event log, sidecar transcripts, and the ability to re-run individual steps.

### Terminology

| Term | Meaning |
|---|---|
| **Run** | One execution of a workflow, stored at `runs/<id>/`. |
| **Token** | Engine unit of execution flowing through the graph; states: `pending | running | complete | skipped | waiting`. |
| **Step** | A node definition (script / agent / approval). |
| **Sidecar** | Per-step stdout/stderr file under `runs/<id>/output/<seq>-<node>.{stdout,stderr}.log`. |
| **Snapshot** | Pure fold of an event stream into `{tokens, retryBudgets, globalContext, completedResults, status, batches}`. |

---

## 2. Grounding: What the Engine Exposes Today

Every feature below is tied to a specific, existing engine capability. This section is the contract the TUI builds on.

### 2.1 Public API (`src/core/index.ts`)

```ts
parseWorkflow(filePath): Promise<WorkflowDefinition>
parseWorkflowFromString(source, filePath?): WorkflowDefinition
validateWorkflow(def): ValidationDiagnostic[]
executeWorkflow(def, options): Promise<RunInfo>
createRunManager(runsDir?): RunManager
replay(events): EngineSnapshot
readEventLog(runDir): Promise<EngineEvent[]>
extractTokenCounter(events): number
loadConfig, DEFAULT_CONFIG
```

### 2.2 Engine options (`EngineOptions`, `src/core/engine.ts`)

| Option | Purpose for the TUI |
|---|---|
| `onEvent(e)` | Live event subscription — the TUI's primary feed. |
| `resumeFrom: ResumeHandle` | Continue a suspended/failed run. |
| `approvalDecision: { nodeId, choice, decidedBy? }` | Decide a waiting approval node. |
| `signal: AbortSignal` | Cancel a running workflow. |
| `beforeStep: BeforeStepHook` | Inspect/mock each step — enables an interactive debugger replacement. |

### 2.3 Event stream (`src/core/types.ts:182-287`)

Every persisted event has `{ seq: number, ts: string, type, ... }`. The TUI subscribes once and folds.

| Event | Key fields | TUI use |
|---|---|---|
| `run:start` | workflowName, sourceFile, inputs, configResolved | Header, run metadata. |
| `token:created` | tokenId, nodeId, parentTokenId?, batchId?, itemIndex? | Tree node insertion; batch membership. |
| `token:state` | tokenId, from → to | Glyph/color update. |
| `step:start` | nodeId, tokenId | Spinner on; detail pane focus candidate. |
| `output:ref` | stepSeq, tokenId, nodeId, stream, path | Register sidecar file for lazy log loading. |
| `step:output` | nodeId, stream, chunk (**non-persisted**) | Live stdout/stderr tail for the detail/log pane. |
| `step:retry` | nodeId, attempt, delayMs, reason | Retry counter + countdown badge. |
| `step:timeout` | elapsedMs, limitMs | Timeout badge + auto-failure. |
| `step:complete` | nodeId, result (edge, summary, local, exit_code) | Final status + summary in detail. |
| `global:update` | keys, patch | Globals inspector. |
| `route` | from, to, edge? | Edge highlight in graph view. |
| `retry:increment` | nodeId, label, count, max | Retry budget bar. |
| `retry:exhausted` | nodeId, label | Red highlight + link to exhaustion handler. |
| `step:waiting` | nodeId, tokenId, prompt, options | **Trigger inline approval modal**. |
| `approval:decided` | nodeId, tokenId, choice, decidedBy | Clear modal, resume tree. |
| `batch:start` / `batch:item:complete` / `batch:complete` | batchId, items, nodeId | Progress bar for forEach fan-out. |
| `workflow:complete` / `workflow:error` | results / error | Terminal banner; exit code. |
| `run:resumed` | resumedAtSeq | "Resumed" marker in timeline. |

### 2.4 Snapshot shape (`EngineSnapshot`)

```ts
{
  tokens: Map<tokenId, Token>,
  retryBudgets: Map<"nodeId:label", { count, max }>,
  globalContext: Record<string, unknown>,
  completedResults: StepResult[],
  status: "running" | "complete" | "error" | "suspended",
  batches: Map<batchId, { nodeId, expected, completed }>,
}
```

### 2.5 Run persistence layout

```
runs/<id>/
  meta.json             # write-through cache
  events.jsonl          # source of truth
  workdir/              # step cwd
  output/<seq>-<node>.{stdout,stderr}.log
```

### 2.6 Control operations the TUI needs

| Operation | How | Source of truth |
|---|---|---|
| Start fresh | `executeWorkflow(def, { onEvent })` | New `runs/<id>/` |
| Resume | `runManager.openExistingRun(id)` → `executeWorkflow(def, { resumeFrom, onEvent })` | Appended to same `events.jsonl` |
| Approve | `executeWorkflow(def, { resumeFrom, approvalDecision, onEvent })` | `approval:decided` event |
| Cancel | `signal.abort()` on the active run | Throws → `workflow:error` |
| Re-run node | `resume` with `--rerun <node>` overrides (existing CLI supports; library consumers can emit synthetic `token:reset` — see §7) | Appended events |
| List / open / replay | `runManager.listRuns()`, `getRun(id)`, `readEventLog(dir)` + `replay()` | events.jsonl |

---

## 3. Must-Have Features (MVP)

Each feature names the engine capability it depends on and the evidence/pattern it borrows.

### 3.1 Workflow browser

**Manual, zero-magic registry.** The TUI never scans for workflows. The list contains exactly what the user has added — explicitly, once.

**Launch**

- `markflow-tui` — opens with whatever is in `./.markflow-tui.json` (empty on first run).
- `markflow-tui <path>` — `<path>` is a `.md` file, workspace dir, directory, glob (`flows/*.md`), or URL. Each resolved match is added to the session.
- Multiple positional args are allowed and each resolved the same way.
- `--no-save` disables auto-persistence (CI, one-off inspection).
- `--list <file>` points at an alternate list file (per-project, not a global).

**Adding from inside the TUI** (`WORKFLOWS` mode)

- `a` — open the "add" modal. Two tabs:
  - **Fuzzy find** — walks the filesystem lazily from a root directory (defaults to CWD, `Ctrl+Up` changes root to any path the user types; **no disk restriction** — workflows often live in a checked-out repo outside the launch dir). Results are filtered to *valid* entries only: `.md` files that parse as a workflow (have `# Flow` + Mermaid block) or directories containing `.markflow.json` (existing workspaces). Other files never appear.
  - **Path or URL** — free-text input, accepts absolute/relative paths, globs, and `http(s)://…`.
- `Enter` confirms. For URL entries the materialisation flow runs immediately: markflow creates the workspace dir, writes the fetched `.md` into it, and records provenance in `.markflow.json` (same as `markflow run <url>` today). The registry entry then points at the **workspace**, not the URL — no separate cache layer.
- `d` removes an entry from the list. Never touches files or workspaces.
- Validation errors (parse fail, 404, unreadable path) stay in the list with an error flag; user chooses when to remove.

**Persistence**

File: `./.markflow-tui.json` in the directory `markflow-tui` was launched from. Plain JSON, checkable into the repo for a shared curated list. No global user-level registry (deliberately out of scope for now).

```json
[
  { "source": "./flows/deploy.md",     "addedAt": "2026-04-15T10:22:00Z" },
  { "source": "../ops-repo/smoke.md",  "addedAt": "..." },
  { "source": "./workspaces/ingest",   "addedAt": "..." }
]
```

- Auto-saved on every add/remove.
- `source` is what the user typed (or the workspace path produced by a URL materialisation). Resolution happens at display time.

**Display**

Each entry is resolved on view; the browser shows a source badge (`[file]` / `[workspace]`), title, last-run status, and a validation flag. Invalid entries remain visible so the user can fix or delete them rather than having them silently disappear.

- Press `enter` → preview pane: parsed sections, Mermaid block, validation diagnostics.
- Press `r` → start a run (opens input prompt if required inputs are declared).

*Engine: `parseWorkflow`, `validateWorkflow`, `RunManager.listRuns` for "last run". URL materialisation reuses the existing `markflow run <url>` workspace-bootstrap code path.*
*Pattern: lazygit left-column list → right-pane preview ([@bwplotka on lazygit](https://www.bwplotka.dev/2025/lazygit/)). Manual-add model inspired by k9s contexts and tmux session lists — nothing appears the user didn't ask for.*

### 3.2 Run list with filtering

- Columns: ID (short), workflow, status (colored + glyph), step, duration, started, note (last error / approval prompt / retry delay).
- **Default sort — attention first:**
  1. Active bucket — `▶ running` + `⏸ waiting` (approvals, suspended), by `started` desc.
  2. Terminal bucket — `✗ failed` + `✓ ok` + cancelled, by `ended` desc.
  Column headers are cyclable with `s` to override (`started`, `ended`, `duration`, `workflow`, `status`).
- **Archive handling — default view hides stale completions.** Initial query shows: all active + completions within the last 24 h + failures within the last 7 d. Footer renders `N shown · M archived · a Show all`. Keeps the table useful when a workspace has thousands of old runs; the archive is one keypress away. Thresholds configurable.
- **Virtualised render.** Only visible rows are drawn (windowed slice, ~30–50 rows) so scrolling stays smooth at 10 k+ runs without pagination UI.
- Status filter: `all` / `running` / `waiting` / `failed` / `ok`. Query bar (`/`) supports `status:`, `workflow:`, `since:`, and free-text id-prefix.
- Search by workflow name or ID prefix (matches existing CLI's prefix semantics).
- `g` / `G` top/bottom; `/` filter; `a` toggle archive inclusion; `s` cycle sort column; `Enter` open run.

*Engine: `listRuns()` + per-run `replay()` for status and seq.*
*Pattern: gh dash configurable sections; k9s filter-as-you-type ([k9s](https://k9scli.io/)). Pain point from current CLI: `ls` has no filtering flags.*

### 3.3 Live run viewer (indented DAG tree)

- Tree of nodes with per-token glyphs: `⊙` pending, `▶` running (animated), `✓` complete, `✗` failed, `○` skipped, `⏸` waiting, `↻` retrying.
- Per-node: duration, attempt (`2/3`), edge taken (success/fail label), first line of step summary.
- Fan-out: children indented under parent; `forEach` batches show `N/M done` progress bar and collapse completed items after a threshold.
- Fan-in (merge): shows waiting-for-upstream indicator.
- `enter` on any node → step detail pane.

*Engine: fold `token:created` / `token:state` / `step:start` / `step:complete` / `batch:*` events.*
*Pattern: Dagger TUI / k9s `:xray` tree with status color ([Edstem on k9s](https://www.edstem.com/blog/k9s-kubernetes-cluster-management/)). Listr2 / tasuku auto-collapse of completed children ([tasuku](https://github.com/privatenumber/tasuku)).*

### 3.4 Step detail pane

- Shows: node ID, type (script/agent/approval), resolved config, templated prompt (agents) or script body (scripts), resolved env (inputs + `MARKFLOW_*`), upstream edge, exit code, `local` / `global` patches.
- For running steps: live sidecar tail (stdout + stderr interleaved with stream labels).
- For complete steps: `summary`, full sidecar accessible via `o` → log pane.

*Engine: `StepDefinition`, `StepResult`, `output:ref` paths, `beforeStep` context (for prompt/env preview).*

### 3.5 Streaming log viewer

- Backed by sidecar files — seek on demand; do **not** buffer entire history in memory (ring buffer of last ~2k lines + lazy file read).
- Follow mode on by default while the owning step is running; scrolling up pauses follow with a visible "PAUSED" indicator; `F` resumes.
- `/` filter (hide non-matching), `s` search (highlight + jump).
- Toggle timestamps (`t`), wrap (`w`), stream filter (`1`=stdout, `2`=stderr, `3`=both).
- Line keys are the event `seq` → cross-references with the tree/graph.

*Engine: `output:ref` + `step:output` events; `readEventLog` for replay of historical runs.*
*Pattern: lnav / nerdlog / lazydocker follow-on-tail, pause-on-scroll ([lnav](https://terminaltrove.com/lnav/); [nerdlog](https://github.com/dimonomid/nerdlog)). Unbounded-scrollback anti-pattern documented in [combray TUI Development](https://combray.prose.sh/2025-12-01-tui-development).*

### 3.6 Inline approval modal

- On any incoming `step:waiting` event (for the currently-viewed run), a modal appears with:
  - Step prompt (rendered Markdown).
  - Selectable options (engine-provided list).
  - Buttons: `[Decide] [View upstream] [Suspend for later] [Cancel]`.
- "Suspend for later" exits the viewer but leaves the run suspended (matching current CLI semantics — run stays in `runs/` with `status: suspended`).
- Typed attribution: `--as` equivalent field prefilled with `$USER`.

*Engine: `step:waiting` event + `executeWorkflow({ approvalDecision })` to resolve.*
*Pattern: [Strong confirmation modal with XState](https://dev.to/jbranchaud/strong-confirmation-modal-with-xstate-4go1) — explicit `idle → confirming → committing → done` states prevent double-submit. Pain point from current CLI: approval requires a separate command invocation.*

### 3.7 Pending-approvals watcher

- Persistent indicator in the status bar: `⏸ 3 waiting`.
- Global view (`:pending` or `P`): table across all runs — same fields as existing `markflow pending` command.
- File-watch on `runs/*/meta.json` status flips to `suspended` → notify inline.

*Engine: `RunManager.listRuns()` + filter on `status === "suspended"`. Gap: no built-in watch API — see §7.*

### 3.8 Resume & re-run controls

- From run-detail: `r` → resume wizard:
  - Shows status, last event, failing node (if any).
  - Optional `--rerun <node>` multi-select on nodes that have completed.
  - Optional `--input KEY=VALUE` edits (audited in the event log per existing CLI behavior).
  - Confirm → `executeWorkflow({ resumeFrom, ... })`.
- Cancel an active run: `X` with strong-confirmation modal.

*Engine: `RunManager.openExistingRun`, existing `resume` command semantics.*

### 3.9 Retry & timeout visibility

- Per-node badge showing `attempt N/M` during step-level retries; countdown for `step:retry` `delayMs`.
- Edge-level retry budget rendered as a small bar near the edge label.
- Exhaustion: red highlight, direct link to the exhaustion handler node.
- Timeout: `⏱` glyph + elapsed/limit in the detail pane.

*Engine: `step:retry`, `retry:increment`, `retry:exhausted`, `step:timeout` events + `retryBudgets` in snapshot.*

### 3.10 Help overlay (`?`) + command palette (`:`)

- `?` — context-sensitive overlay: only the bindings active in the focused pane + current mode. Searchable.
- `:` — vim-style command bar: `:run <workflow>`, `:resume <id>`, `:cancel`, `:approve <choice>`, `:pending`, `:goto <seq>`, `:theme`, `:quit`.
- Bottom status bar always shows the 4–6 most-relevant bindings for the current mode.

*Pattern: lazygit `?` context help ([keybindings docs](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)), k9s `:` command palette. Discoverability anti-pattern — if it's not in `?` or the keybar, it doesn't exist.*

---

## 4. Nice-to-Haves (Post-MVP)

| Feature | Sketch | Depends on |
|---|---|---|
| **ASCII Mermaid overlay** | Press `m` in the graph view → render the workflow's Mermaid source as an ASCII box-and-arrow graph overlay using [`beautiful-mermaid`](https://github.com/lukilabs/beautiful-mermaid) (zero DOM, Node-native) or shell-out to [`mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii). | Existing Mermaid parser output. |
| **Run comparison / diff** | Pick two runs of the same workflow → side-by-side tree with differences colorized (different edge taken, different durations, different retry counts). | `replay()` of both. |
| **Transcript search (cross-step)** | `ctrl-/` → ripgrep-style search across all sidecar files of the current run. | sidecar layout. |
| **Interactive `beforeStep` debugger** | Replace `debug.ts`'s readline UI: breakpoint list, step-over / continue / skip, mock-directive builder from a form — visual replacement for the blocking readline flow. | `beforeStep` hook. |
| **Saved filter views** | gh-dash style — users save named filters for the run list (e.g., "failed in last 24h", "my pending approvals"). | `listRuns()` + a local YAML config. |
| **Workspace switcher** | Quick-switch between workspaces under a parent dir; persisted recents. | `.markflow.json`. |
| **Input form generator** | Parse `# Inputs` section → rendered Ink form using `@inkjs/ui` inputs + `@clack/prompts` for richer types. | `InputDeclaration[]` from parser. |
| **VHS regression snapshots** | Record canonical flows (start / approve / resume) as [VHS](https://leg100.github.io/en/posts/building-bubbletea-programs/) scripts for PR review. | — |
| **`--watch` / `--plain` modes** | Non-TTY output variants mirroring `gh run watch` semantics: block until done, exit non-zero on failure, stable line output ([gh run watch manual](https://cli.github.com/manual/gh_run_watch)). | Same `onEvent` stream. |

---

## 5. Proposed UX

### 5.1 Information architecture

Four modes, explicit state machine. Only one mode active at a time; the keybar reflects the mode.

```
┌─ app mode ─────────────────────────────────────────────────┐
│  browsing                                                  │
│    ├── workflow-browser  (F1 / 1)                          │
│    └── run-list          (F2 / 2)                          │
│  viewing-run                                               │
│    ├── graph-pane        (focus 3)                         │
│    ├── detail-pane       (focus 4)                         │
│    └── log-pane          (focus 5)                         │
│  overlays (modal; trap focus; esc closes)                  │
│    ├── approval-modal                                      │
│    ├── resume-wizard                                       │
│    ├── command-palette   (:)                               │
│    ├── help-overlay      (?)                               │
│    └── confirm-cancel                                      │
└────────────────────────────────────────────────────────────┘
```

### 5.2 Layout — wide (≥140 cols)

```
┌ Runs ─────────────┐┌ Graph / Steps ─────────────┐┌ Detail ─────────────┐
│ ● abcd12  2m      ││ ▼ deploy-prod              ││ step: build         │
│ ● efgh34  live    ││   ├─▶ build    (12s, 2/3)  ││ type: script (bash) │
│ ⏸ ijkl56  ⏸       ││   ├─✓ test     (8s)  next  ││ attempt: 2/3        │
│ ✗ mnop78  err     ││   ├─⏸ review   waiting     ││ edge: —             │
│ ✓ qrst90  ok      ││   └─⊙ publish  pending     ││ exit: —             │
│                   ││                            ││ local: { sha:"ab..} │
│ filter: running   ││ batch [regions]  3/5 ████░ ││ stderr tail:        │
└───────────────────┘└────────────────────────────┘│  warn: slow link    │
                                                   └─────────────────────┘
┌ Log (follow) ─ seq=142 ──────────────────────────────────────────────────┐
│ 12:03:11 seq=140 [build] stdout compiling src/index.ts                   │
│ 12:03:12 seq=141 [build] stdout warning TS6133 unused variable           │
│ 12:03:14 seq=142 [build] stdout compiled in 3.2s                      ⏵  │
└──────────────────────────────────────────────────────────────────────────┘
 [?] help  [:] cmd  [/] filter  [F] follow  [r] resume  [a] approve  [X] cancel
```

### 5.3 Layout — medium (80–140 cols)

Right detail pane collapses into an inline popover under the selected node in the graph pane. Log pane remains at the bottom.

### 5.4 Layout — narrow (<80 cols)

Single pane with a breadcrumb stack: `Runs › abcd12 › build › log`. `esc` pops. (k9s pattern — [k9s](https://k9scli.io/).)

### 5.5 Keymap (grouped by mode)

**Global**

| Key | Action |
|---|---|
| `?` | Context help overlay |
| `:` | Command palette |
| `tab` / `shift-tab` | Cycle focus |
| `1`–`5` | Jump to pane |
| `q` | Quit (at top level) / close overlay |
| `esc` | Pop navigation / close modal |

**Lists & trees**

| Key | Action |
|---|---|
| `j`/`k` or ↑/↓ | Move selection |
| `g`/`G` | Top / bottom |
| `enter` | Drill in |
| `/` | Filter |
| `n`/`N` | Next / prev match |

**Run-list mode**

| Key | Action |
|---|---|
| `enter` | Open run viewer |
| `r` | Resume run |
| `X` | Cancel run (confirmation) |
| `s` | Toggle status filter |

**Run-viewer mode**

| Key | Action |
|---|---|
| `enter` on node | Focus step in detail pane |
| `o` | Open log pane for selected node |
| `m` | Toggle ASCII Mermaid overlay (post-MVP) |
| `a` | Decide pending approval (opens modal) |
| `r` | Resume wizard |
| `R` | Re-run selected node (resume with `--rerun`) |
| `F` | Toggle follow mode |

**Log-pane mode**

| Key | Action |
|---|---|
| `w` | Wrap toggle |
| `t` | Timestamps toggle |
| `1`/`2`/`3` | stdout / stderr / both |
| `s` | Search mode |

### 5.6 Keybar — the bottom status/command line

Inspired specifically by **zellij** and **process-compose**, both of which were called out as exemplary. The keybar is a first-class design element, not an afterthought. Full research: internal notes at `/Users/boyd/.claude/plans/gentle-honking-toucan-agent-a8fc9f4c1d4b34c35.md`.

**What we steal from zellij** ([status-bar source](https://github.com/zellij-org/zellij/tree/main/default-plugins/status-bar); [DeepWiki analysis](https://deepwiki.com/zellij-org/zellij/4.3-built-in-plugins); [0.31 release notes](https://zellij.dev/news/sixel-search-statusbar/)):

- **Live keymap is the single source of truth.** Since zellij 0.31, the status bar reads `get_mode_keybinds()` directly, so user rebinds reflect in the bar automatically. The markflow TUI defines each binding once as `{ keys, label, shortLabel?, category?, when, action }` — one array feeds both `useInput()` and `<KeyBar>`. Never hardcode hints next to handlers.
- **Three-tier responsive fallback.** Full (`<hjkl> Change Focus`) → Short (`<hjkl> Move`) → Best-effort (drop trailing entries, append `…`). Same pattern for mode tabs: `<g> LOCK` → `^C LOCK` → `g`.
- **Shared-modifier extraction.** `Ctrl + <n|p|t>` beats three `Ctrl +` repeats — zellij issue [#3771](https://github.com/zellij-org/zellij/issues/3771) is the cautionary density case.
- **Grouped directionals.** `<←↓↑→> Change focus` as one hint, not four.
- **Angle-bracket key format** with modifiers spelled out: `<a>`, `<ENTER>`, `<ESC>`, `Ctrl + <a>`.
- **Mode-tab row optional.** If we add explicit modes (approval, resume-wizard), a thin second row above the hint line with the active mode highlighted.

**What we steal from process-compose** ([actions.go](https://github.com/F1bonacc1/process-compose/blob/main/src/tui/actions.go); [view.go](https://github.com/F1bonacc1/process-compose/blob/main/src/tui/view.go); [shortcuts wiki](https://github.com/F1bonacc1/process-compose/wiki/Shortcuts-Configuration)):

- **Context branches, not a modal stack.** `updateHelpTextView()` has three branches (terminal focused / search active / default). The markflow keybar does the same: `visibleHints(mode, focus, selection) → Hint[]` — a pure function that rebuilds from scratch on every context change.
- **Inline category labels** in a muted bold color, e.g., `RUN:` / `VIEW:` / `LOGS:`. Replaces process-compose's `LOGS:` / `PROCESS:` split.
- **Color-split key vs label.** Key rendered in one color (`<Text bold color="cyan">`), label in another. Your eye finds the key before the description.
- **Toggles flip their label.** `f Follow` ↔ `f Unfollow`, `w Wrap` ↔ `w NoWrap` — clearer than a static label with a state pill elsewhere.
- **Never show a key you can't press.** Hide disabled hints rather than greying them (zellij's locked-mode grey-out is the anti-pattern).
- **YAML-overridable bindings.** Allow `~/.config/markflow/shortcuts.yaml` to remap key and/or label; partial override (missing entries keep defaults).

**Anti-patterns to avoid** (from both tools' complaints):

- Hardcoded colors in the bar component (zellij's green-tint complaint, [Haseeb Majid blog](https://haseebmajid.dev/posts/2024-07-26-how-i-configured-zellij-status-bar/)) — put all colors behind a theme object.
- No narrow-terminal fallback (process-compose clips buttons at narrow widths) — zellij's three-tier is mandatory.
- F-keys for destructive actions — they collide with terminal-emulator menus (Gnome Terminal, VS Code). Reserve F-keys for benign toggles; use `Ctrl-letter` or letter-with-confirm for destructive ops.
- Rotating tips on a timer — competes for attention. Zellij caches one tip per session; we should too if we add tips.
- Greying disabled hints inline with active ones — hide them.

**Rules for markflow's keybar**

1. **Always visible**: `?` help, `q` quit (top level) or `Esc` back (inside detail).
2. **Category headers** in muted bold: max two categories per line (e.g., `RUN` + `VIEW`).
3. **Ordering within a line**: local verbs (open / approve / cancel) → view toggles (follow, wrap, filter) → globals (help, quit).
4. **Destructive actions in red** (`X Cancel`, `D Deny`). Everything else uses the neutral theme.
5. **Hide, don't grey.** Omit hints whose `when(ctx)` returns false.
6. **Toggle label flips** — `Follow` ↔ `Unfollow`, `Wrap` ↔ `NoWrap`.
7. **Width tiers**:
   - ≥100 cols: full labels.
   - 60–100 cols: `shortLabel` if defined, else truncate label with `…`.
   - <60 cols: keys only + a one-line tip "`?` for labels".
8. **Mode pill** (reverse video) when inside a modal overlay: `[APPROVAL]`, `[RESUME]`.
9. **Single keymap array.** `defineBinding({ keys, label, shortLabel, category, when, action })` feeds both the handler (`useInput`) and the renderer (`<KeyBar>`).
10. **Theme-driven colors** via a `useTheme()` hook; no literals in the component.

**Data model**

```ts
interface Binding {
  keys: string[];                  // ["f"] or ["Ctrl", "r"] or ["Left","Down","Up","Right"]
  label: string;                   // "Follow"
  shortLabel?: string;             // "Fllw"
  toggleLabel?: (state: unknown) => string;  // state → "Unfollow"
  category?: string;               // "VIEW"
  destructive?: boolean;
  when: (ctx: AppContext) => boolean;
  action: (ctx: AppContext) => void | Promise<void>;
}
```

`<KeyBar>` subscribes to `AppContext`, calls `bindings.filter(b => b.when(ctx))`, groups by `category`, formats with `formatKeys(b.keys)` (`"Ctrl + <r>"` style), measures total width via the theme's character metrics, picks a tier, and renders. Memoize on `(mode, focus, selection)` to avoid flicker.

**ASCII mocks**

Wide (≥100 cols), run-viewer with follow on, one approval pending:

```
 RUN  ↑↓ Step  ⏎ Logs  a Approve (1)  X Cancel   VIEW  f Unfollow  / Filter  w Wrap   ?  q
```

Medium (~80 cols):

```
 RUN  ↑↓ Step  ⏎ Logs  a Approve  X Cancel   VIEW  f Unfollow  /  w   ?  q
```

Narrow (<60 cols):

```
 ↑↓ ⏎ a X  |  f / w  |  ? q            press ? for labels
```

Inside the approval modal (mode pill):

```
 [APPROVAL]  ⏎ Decide  e Edit inputs  s Suspend-for-later   Esc Cancel
```

### 5.7 Walkthrough — starting a run

1. `F1` → workflow browser → select `deploy.md` → `enter`.
2. Preview pane shows Mermaid graph, inputs declared.
3. `r` → input form (only if required inputs missing) → submit.
4. TUI switches to **viewing-run** mode. Graph tree renders pending nodes. Start node becomes `▶` immediately.
5. Parallel fan-out: two children animate in parallel with their own spinners; durations update.
6. On `step:complete` success: spinner → `✓` + edge label. Completed row becomes immutable (pushed into `<Static>` per [Ink 3 release notes](https://vadimdemedes.com/posts/ink-3)).
7. Keybar reflects current pane context throughout.

### 5.8 Walkthrough — handling an approval

1. Run is in progress, viewing graph. `step:waiting` event fires for node `review`.
2. Keybar shows `[a] approve (1)` with a count badge.
3. Press `a` → modal opens with prompt + options. Background dimmed.
4. User picks an option → confirm.
5. TUI emits `executeWorkflow({ resumeFrom, approvalDecision: {...} })` in a background task.
6. `approval:decided` event arrives → modal dismisses → tree continues.
7. "Suspend for later" exit also works: closes modal and the run stays `suspended` in `runs/`.

### 5.9 Walkthrough — resuming a failed run

1. `F2` → run list with filter `error` → select run.
2. `r` → resume wizard:
   - Shows failing node and last event.
   - Multi-select `--rerun` nodes (defaults to the failing one).
   - Optional input edits (listed as `KEY=current → new`).
3. Confirm → new events append to the same `events.jsonl`; TUI switches to viewing-run mode.
4. `run:resumed` marker appears in the timeline.

### 5.10 Visual vocabulary

**Glyphs** (pair with color — never color alone; [accessibility.princeton.edu — avoid color alone](https://accessibility.princeton.edu/how/design/color-alone)):

| State | Glyph | Color |
|---|---|---|
| Pending | `⊙` | dim |
| Running | `▶` / spinner | blue |
| Complete | `✓` | green |
| Failed | `✗` | red |
| Skipped | `○` | dim grey |
| Waiting (approval) | `⏸` | yellow |
| Retrying | `↻` | yellow |
| Timeout | `⏱` | red |
| Batch | `⟳` | magenta |
| Route | `→` | dim cyan |

**ASCII fallback** (`--ascii` flag + auto-detect for terminals without UTF-8 box-drawing): text-only variants — `[run] [ok] [fail] [wait] [retry]`.

**Color policy** — respect `NO_COLOR`. Every state-encoding color is paired with a glyph and a text label in the detail pane. Offer a high-contrast theme and an 8-color-terminal theme. [Turborepo #10726](https://github.com/vercel/turborepo/issues/10726) is the cautionary example.

**Spinners** — one per active token; throttled to ~10 fps; paused off-screen. [combray TUI Development](https://combray.prose.sh/2025-12-01-tui-development) on FPS caps.

---

## 6. Technical Approach

### 6.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Renderer | **Ink** (React on Yoga flexbox) | Maps directly onto `replay()`-style state folds; used in production by Claude Code, Gemini CLI, Wrangler. [vadimdemedes/ink](https://github.com/vadimdemedes/ink). |
| UI primitives | **@inkjs/ui** | Spinner, ProgressBar, StatusMessage, Alert, TextInput, theming hook — covers ~80% of primitives. [ink-ui](https://github.com/vadimdemedes/ink-ui). |
| Out-of-UI prompts | **@clack/prompts** | For `markflow-tui --run` input collection before the full UI mounts. [@clack/prompts vs Inquirer](https://dev.to/chengyixu/clackprompts-the-modern-alternative-to-inquirerjs-1ohb). |
| State machines | **XState** (or hand-rolled discriminated union) | Modal flows (approval, resume, confirm-cancel) are explicit FSMs — prevents double-submits. [xstate.js.org](https://xstate.js.org/). |
| Fuzzy finding | **fuzzysort** | In-process, fast. |
| ASCII graphs (post-MVP) | **beautiful-mermaid** | Consumes the same Mermaid source, zero DOM. [lukilabs/beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid). |

**Why not blessed/neo-blessed** — neo-blessed is lightly maintained ([libhunt](https://www.libhunt.com/r/neo-blessed)); Ink has clear momentum and TypeScript-first ergonomics.

### 6.2 Data flow

```
┌────────────┐   onEvent(e)   ┌──────────┐  dispatch   ┌──────────┐
│ markflow   │──────────────▶ │ reducer  │───────────▶ │  store   │
│ engine     │                │ (pure    │             │  (React  │
│            │                │  fold)   │             │  context)│
└────────────┘                └──────────┘             └─────┬────┘
     │                              ▲                       │
     │ start / resume / approve     │                       │ props
     │ (commands via FSM)           │ historical events     ▼
     │                              │ readEventLog()   ┌──────────┐
     │                              └──────────────────│   UI     │
     └────────────────────────────────────────────────▶│ (Ink)    │
                                                       └──────────┘
```

- **Single source of truth** = the event log. The reducer is *the same fold logic as* `replay()`. On open-existing-run, call `readEventLog` → `replay` once to hydrate, then subscribe.
- **Stable keys = `seq`.** Cross-view alignment (log ↔ graph ↔ detail) uses `seq` as the identifier.
- **`<Static>` for completed steps.** Finished step rows are immutable; push into `<Static>` so React doesn't re-reconcile them ([Ink 3 release notes](https://vadimdemedes.com/posts/ink-3)).
- **Ring buffer for step:output.** Keep last N lines in memory; seek into sidecar files for history on user scroll-up.
- **Flicker mitigation** — follow the path Anthropic documented: differential rendering by default, alt-screen mode behind a flag for users who want a stable viewport ([Signature Flicker](https://steipete.me/posts/2025/signature-flicker); [CLAUDE_CODE_NO_FLICKER](https://slyapustin.com/blog/claude-code-no-flicker.html)).
- **Raw-mode / SIGWINCH discipline** — use Ink's `setRawMode` (not `process.stdin.setRawMode`), wire a SIGWINCH handler (Ink doesn't auto-handle — [combray](https://combray.prose.sh/2025-12-01-tui-development)), restore cooked mode on every exit path including uncaught exceptions.

### 6.3 Mode FSM sketch

```ts
type Mode =
  | { kind: "browsing"; pane: "workflows" | "runs" }
  | { kind: "viewing"; runId: string; focus: "graph" | "detail" | "log" }
  | { kind: "overlay"; parent: Mode; overlay: Overlay };

type Overlay =
  | { kind: "approval"; runId: string; nodeId: string; state: "idle" | "submitting" }
  | { kind: "resumeWizard"; runId: string; rerun: Set<string>; inputs: Record<string, string> }
  | { kind: "confirmCancel"; runId: string }
  | { kind: "commandPalette"; query: string }
  | { kind: "help"; context: Mode };
```

The keymap handler takes `(mode, keypress)` and returns `(mode', commands[])`. Commands are side-effects (engine calls, file reads) isolated from the reducer.

### 6.4 Integration with the existing CLI

The TUI is a **separate binary**, `markflow-tui`, not a subcommand of `markflow`. Non-TTY invocation prints a message + suggests `markflow run --plain` (see §4). All existing CLI commands remain untouched — the TUI consumes the same public API from `packages/markflow/src/core/index.ts`, imported as `markflow` (the library package).

### 6.5 Packaging & distribution

**Monorepo with npm workspaces.** Two packages, independent publishes, one `npm install` at the root.

```
markflow/                       ← repo root
├── package.json                ← workspaces: ["packages/*"]
├── packages/
│   ├── markflow/               ← existing CLI + engine; stays pure
│   │   ├── package.json        ← no Ink, no React, yargs only
│   │   ├── src/core/           ← public API lives here
│   │   └── src/cli/            ← thin yargs wrapper
│   └── markflow-tui/           ← new
│       ├── package.json        ← dependencies: { markflow: "workspace:*", ink: "...", ... }
│       ├── src/                ← Ink app
│       └── test/
└── docs/
```

- **Binary:** `markflow-tui` (dedicated CLI in `packages/markflow-tui/package.json#bin`). Distinct from `markflow`.
- **Install model:** users who want CLI only run `npm i -g markflow`; users who want the TUI run `npm i -g markflow-tui` which transitively pulls `markflow` (as a regular runtime dep, pinned to a compatible minor). CI / Lambda / minimal Docker images stay Ink-free.
- **Dependency direction:** `markflow-tui` → `markflow`. Never the reverse. The CLI does not know the TUI exists.
- **Interface contract:** the TUI imports *only* from the `markflow` package's main entry (the public API). Any functionality the TUI needs that isn't already exported must be promoted into the public API first (see §7). No reaching into `markflow/src/core/runner/` or other internals.
- **Versioning:** independent semver per package. A TUI release does not require a CLI release; engine-side additions that the TUI consumes happen via minor-version bumps of `markflow` with the TUI widening its peer range.

### 6.6 Testing

- **Unit** — reducer tests on canned event streams (the fold is pure; these are the same kind of tests `replay.ts` already has).
- **Component** — `ink-testing-library` snapshot tests for each pane given a snapshot input.
- **E2E** — VHS scripts recording canonical flows; diff on PRs ([leg100 on VHS](https://leg100.github.io/en/posts/building-bubbletea-programs/)).

---

## 7. Public-API additions required by the TUI

Because `markflow-tui` consumes `markflow` as an external library (see §6.5) and may not reach into internals, every engine capability the TUI needs must be **exported from the public API** (`packages/markflow/src/core/index.ts`). The items below are **mandatory additions**, not nice-to-haves — without them, the TUI either can't function or must duplicate engine state, which defeats the thin-projection design.

Promotion is the action: "currently private helper X must become a named export with stable signature." Where an entirely new API is needed, that's called out explicitly. These additions belong in `markflow`, not `markflow-tui`, so the CLI itself can also benefit (e.g., `markflow ls` today does N-replay-scans; a proper list helper fixes both at once).

| Gap | Proposed addition | Rationale |
|---|---|---|
| No watch API for new runs / status changes | Helper: `runManager.watch()` returning an `AsyncIterable<RunEvent>` backed by `fs.watch` on `runs/*/meta.json` | Pending-approvals indicator + auto-refresh of run list without polling. |
| No concurrent-resume guard | File-lock (`runs/<id>/.lock`) acquired at `openExistingRun` | Two TUI instances (or a CLI + TUI) resuming the same run corrupts the log. |
| Graph helpers not re-exported | Re-export `getTerminalNodes`, `getUpstreamNodes`, `isMergeNode` from `src/core/graph.ts` via `src/core/index.ts` | Tree rendering + fan-in indicator need these. |
| No sidecar resolver | Helper: `getSidecarStream(runDir, seq, stream)` returning a `ReadableStream` of the sidecar file | Every log-pane consumer otherwise reinvents path resolution. |
| Batch membership query | Add `tokensByBatch(snapshot, batchId): Token[]` | Rendering batch progress without iterating `snapshot.tokens` each frame. |
| Incremental event tail | Helper: `tailEventLog(runDir, fromSeq)` returning an `AsyncIterable<EngineEvent>` | Attaching to a live run started by another process (e.g., CLI kicked off, TUI attaches). |
| `beforeStep` structured mock directives | Already present — just document the shape | For the post-MVP interactive debugger. |
| Cancel semantics on detached runs | Clarify: can the TUI cancel a run started by another process? Today `signal` is process-local. | Probably "no" for MVP; document. |

None of these require engine behavior changes — they're thin wrappers.

---

## 8. Open Questions

1. **Ink vs a Go rewrite?** Ink is the right fit for a Node codebase, but if markflow ever grows a Go port (the DAG engine would fit Bubble Tea beautifully), the TUI would need a parallel implementation. Is cross-language parity a goal?
2. **Scope of MVP — do we ship with or without the ASCII Mermaid overlay?** The indented tree covers 90% of live-view needs; the Mermaid overlay is a demo-friendly feature but adds a dependency. Lean ship-without.
3. **Run ownership / multi-user.** Is it ever the case that one user kicks off a run and another approves? If yes, the concurrent-resume guard (§7) becomes critical path, not nice-to-have.
4. **Authoring loop.** Should the TUI watch the workflow file and auto-rerun validation on save? Would blur the "no authoring" non-goal but would be delightful.
5. **Theme & color budget.** How much time to spend on themes (k9s-style skins) vs just a single tuned theme + `NO_COLOR` fallback?
6. **Where does `debug.ts` go?** The existing readline debug mode could remain as the CLI-only debugger, or the TUI's post-MVP `beforeStep` panel could replace it. Picking one avoids carrying two.
7. **`--watch` / `--plain` modes in the same binary?** Adding non-interactive modes to `markflow-tui` overlaps with `markflow run`. Probably cleaner to extend `run` with `--watch` rather than overload `tui`.

---

## 9. References

### markflow internals

- `src/core/index.ts` — public API surface.
- `src/core/types.ts:182-287` — event payloads.
- `src/core/engine.ts` — engine options, approval/resume logic, token lifecycle.
- `src/core/replay.ts` — pure fold; the shape the TUI reducer mirrors.
- `src/core/run-manager.ts` — run directory lifecycle.
- `src/cli/render-events.ts` — existing terminal rendering to preserve parity with.
- `src/cli/commands/*.ts` — feature parity baseline (`run`, `resume`, `approve`, `pending`, `ls`, `show`).
- `src/cli/debug.ts` — existing readline debugger (potentially replaced post-MVP).
- `docs/arch/event-sourced-run-log.md` — run persistence details.
- `docs/arch/routing-and-retries.md` — retry/timeout semantics surfaced in §3.9.
- `CLAUDE.md` — architecture overview.

### TUI precedents

- [lazygit](https://github.com/jesseduffield/lazygit) — 4-panel master-detail, `?` context help, vim keys, `:` command mode. [@bwplotka on lazygit](https://www.bwplotka.dev/2025/lazygit/); [Bytesizego](https://www.bytesizego.com/blog/lazygit-the-terminal-ui-that-makes-git-actually-usable); [keybindings docs](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md).
- [k9s](https://k9scli.io/) — `:command` palette, `:xray` tree view, SSH-friendly rendering. [Edstem](https://www.edstem.com/blog/k9s-kubernetes-cluster-management/).
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) — Elm architecture; [leg100 field guide](https://leg100.github.io/en/posts/building-bubbletea-programs/).
- [btop](https://itsfoss.com/btop-plus-plus/), [bottom](https://github.com/ClementTsang/bottom), htop — dense visualization, sparkline patterns.
- [gh run watch](https://cli.github.com/manual/gh_run_watch) — `--watch` blocking mode, non-zero exit on failure. [nedbat/watchgha](https://github.com/nedbat/watchgha) as cautionary alt.
- [Claude Code UI layer (DeepWiki)](https://deepwiki.com/alesha-pro/claude-code/7-ui-layer-(inkreact-tui)); [Ink renderer details](https://deepwiki.com/alesha-pro/claude-code/7.1-ink-renderer-and-custom-tui-engine); [Boris Cherny on the rewrite](https://www.threads.com/@boris_cherny/post/DSZbZatiIvJ/weve-rewritten-claude-codes-terminal-rendering-system-to-reduce-flickering-by); [Signature Flicker](https://steipete.me/posts/2025/signature-flicker); [CLAUDE_CODE_NO_FLICKER](https://slyapustin.com/blog/claude-code-no-flicker.html).
- [tig](https://github.com/jonas/tig), [aider](https://aider.chat/), [lnav](https://terminaltrove.com/lnav/), [nerdlog](https://github.com/dimonomid/nerdlog) — master-detail, conversational pager, log viewer.
- [Argo CLI](https://argo-workflows.readthedocs.io/en/latest/walk-through/argo-cli/); [ZenML orchestration showdown](https://www.zenml.io/blog/orchestration-showdown-dagster-vs-prefect-vs-airflow) — confirmation that no major orchestrator ships a serious TUI; markflow's opportunity.
- [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii); [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid); [Cursor CLI Mermaid](https://cursor.com/changelog/cli-feb-18-2026) — ASCII DAG rendering options.

### Node TUI frameworks

- [Ink](https://github.com/vadimdemedes/ink); [Ink 3 release notes](https://vadimdemedes.com/posts/ink-3); [@inkjs/ui](https://github.com/vadimdemedes/ink-ui).
- [combray — TUI Development](https://combray.prose.sh/2025-12-01-tui-development); [combray — Expandable layouts](https://combray.prose.sh/2025-11-28-ink-tui-expandable-layout).
- [neo-blessed](https://github.com/embarklabs/neo-blessed); [libhunt](https://www.libhunt.com/r/neo-blessed).
- [@clack/prompts vs Inquirer](https://dev.to/chengyixu/clackprompts-the-modern-alternative-to-inquirerjs-1ohb); [Enquirer](https://github.com/enquirer/enquirer).
- [Listr2](https://github.com/listr2/listr2); [tasuku](https://github.com/privatenumber/tasuku).
- [OpenReplay — Building terminal interfaces with Node.js](https://blog.openreplay.com/building-terminal-interfaces-nodejs/).

### UX patterns

- [XState](https://xstate.js.org/); [Strong confirmation modal with XState](https://dev.to/jbranchaud/strong-confirmation-modal-with-xstate-4go1).
- [Princeton — avoid color alone](https://accessibility.princeton.edu/how/design/color-alone); [Smashing — designing for colorblindness](https://www.smashingmagazine.com/2024/02/designing-for-colorblindness/); [Turborepo #10726](https://github.com/vercel/turborepo/issues/10726).

---

*End of proposal. Next step: review, triage MVP scope, and if approved, start with §3.1–§3.3 (workflow browser + run list + live run viewer) as the first implementation slice.*
