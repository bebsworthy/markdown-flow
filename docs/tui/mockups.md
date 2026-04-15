# markflow TUI — ASCII Mockups

> Companion to [`features.md`](./features.md). These are plain-text mocks — color, bolding, and reverse-video (mode pills) are **annotated** under each block, not rendered in ASCII. Read in a monospace font.
>
> All widths below are terminal columns. Box-drawing matches a 256-color UTF-8 terminal; §15 shows the ASCII-only fallback.

---

## 1. App shell — ≥140 cols, run in progress

**process-compose-style stacked layout.** Top half is a full-width **runs table**; bottom half is a **tabbed detail pane** (Graph · Detail · Log · Events) for the currently selected run. One focus at a time, no competing side panels. Cursor is on run `abcd12`; the bottom pane shows its graph.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║ Runs   sort: attention ↓   filter: all · last 24h                             5 shown · 9 995 archived · a Show all           ║
║                                                                                                                               ║
║   ID       WORKFLOW      STATUS      STEP         ELAPSED    STARTED           NOTE                                           ║
║ ▶ abcd12   deploy        ▶ running   build 2/3    2:14       12:01:03          ↻ retrying · delay 4s                          ║
║   efgh34   deploy        ⏸ waiting   review       —          11:47:20          "confirm prod?"                                ║
║   ijkl56   deploy        ✗ failed    publish      1:52       10:12:08          exit 1 · retries exhausted                     ║
║   mnop78   smoke         ✓ ok        —            0:48       09:30:51                                                         ║
║   qrst90   ingest        ✓ ok        —            3:12       08:14:02                                                         ║
║                                                                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║  [ Graph ]  Detail  Log  Events                                    abcd12 · deploy-prod · build · seq=142                     ║
║                                                                                                                               ║
║   ▼ deploy-prod                                                                                                               ║
║     ├─▶ build      12s   attempt 2/3   ↻ retrying · delay 4s                                                                  ║
║     ├─✓ test        8s   → next                                                                                               ║
║     ├─⏸ review     waiting  "confirm prod?"                                                                                   ║
║     └─⊙ publish    pending                                                                                                    ║
║                                                                                                                               ║
║     ⟳ batch [regions]  3 / 5   ████████░░░░                                                                                   ║
║                                                                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 RUNS  ↑↓ Select  ⏎ Open  / Filter  r Resume (1)  X Cancel    VIEW  1/2/3/4 Tab   ? Help   q Quit
```

- **Stacked, not side-by-side**: top half owns the run inventory (process-compose's process table analogue); bottom half is a single focused pane switched by `1`/`2`/`3`/`4` or `Tab` — Graph / Detail / Log / Events. No third box competing for space.
- Moving the cursor in the top table live-updates the bottom pane (follow-selection). `⏎` zooms the bottom pane to full screen and hides the table (RUN mode).
- Keybar category is **RUNS** because the table has focus; switching focus to the bottom pane flips the first category to **RUN** (graph-nav bindings). Destructive `X Cancel` is red.
- `r Resume (1)` appears because one run is suspended; the badge would vanish if none were waiting (hide-don't-grey, §5.6 rule 5).
- Splitter at the middle `╠═══╣` is draggable with `-` / `+` to rebalance halves.
- **Sort** defaults to *attention*: active (`▶`/`⏸`) first by start desc, then terminal (`✗`/`✓`) by end desc. `s` cycles sort columns. **Archive** defaults hide completions older than 24h + failures older than 7d; footer shows `N shown · M archived`, `a` toggles the archive in. Rows are virtualised so 10 k+ runs scroll smoothly (features.md §3.2).

---

## 2. Workflow browser

**Manual registry.** The list is exactly what the user has added via launch args or the `a` add-modal — no scanning. Left = registered entries with source badge; right = preview of the selected one. List is persisted to `./.markflow-tui.json`.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║ Workflows  (./.markflow-tui.json)                        │ deploy.md                                     ║
║──────────────────────────────────────────────────────────┼───────────────────────────────────────────────║
║ ▶ ./flows/deploy.md              [file]       ✓ 2h       │ # Deploy to production                        ║
║   ../ops-repo/smoke.md           [file]       ✓ 1d       │                                               ║
║   ./workspaces/ingest            [workspace]  ✗ 3d       │ Promotes a green build through staged regions.║
║   ./flows/multi-region.md        [file]       — never    │                                               ║
║   ./flows/broken.md              [file]       ✗ parse    │ ## Inputs                                     ║
║                                                          │   sha      required   commit to deploy        ║
║ 5 entries · 1 error                                      │   regions  default:us,eu                       ║
║                                                          │                                               ║
║                                                          │ ## Flow                                       ║
║                                                          │   build → test → review(approval) → publish   ║
║                                                          │                 └─▶ forEach regions: deploy   ║
║                                                          │                                               ║
║                                                          │ 9 steps · 1 approval · 1 forEach              ║
║                                                          │ diagnostics: ✓ validated                      ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 WORKFLOWS  ↑↓ Select  ⏎ Open  r Run  a Add  d Remove  e Edit in $EDITOR     ? Help   q Quit
```

- Source badge (`[file]` / `[workspace]`) makes origin obvious — workspaces also appear here because they self-contain their workflow plus prior runs. URL entries have already been materialised into a workspace on add, so no `[url]` badge at rest.
- Invalid entry (`broken.md · ✗ parse`) stays in the list with an error flag, rather than silently vanishing — user chooses when to `d` it.
- `a Add` opens the add-modal (fuzzy-find across whole disk, or paste a path / URL). `d Remove` deletes the entry from the list only, never touches files or workspaces.
- The title bar shows the list file path so the user knows where persistence lives; `--no-save` mode would show `Workflows  (session only)`.

**Empty-state hint (first-ever launch)**

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                                          ║
║                              No workflows registered yet.                                                ║
║                                                                                                          ║
║                              Press  a  to add by fuzzy-find or path/URL                                  ║
║                              or relaunch:   markflow-tui <path|glob|url>                                 ║
║                                                                                                          ║
║                              The list will be saved to ./.markflow-tui.json                        ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 WORKFLOWS  a Add     ? Help   q Quit
```

- Empty state keeps only the two keys that make sense (`a`, `?`, `q`) — strongest demonstration of hide-don't-grey. No `↑↓`, no `⏎`, no `r` because nothing is selectable.

**Add modal (fuzzy-find tab)**

```
┌─ Add workflow ──────────────────────────────────────────────────────────────┐
│  [ Fuzzy find ]   Path or URL                                               │
│                                                                             │
│  root:  ~/code        (Ctrl+Up to change — anywhere on disk)                │
│  find:  depl                                                                │
│                                                                             │
│   ► ~/code/infra/flows/deploy.md            [file]                          │
│     ~/code/infra/flows/deploy-staging.md    [file]                          │
│     ~/code/side-project/deploy/             [workspace]                     │
│     ~/code/old/deploy.md                    [file · ✗ parse]                │
│                                                                             │
│   Tab  switch input mode    ⏎  Add    Esc  Cancel                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Results filtered to *valid* entries only — other `.md` files never appear. Parse-failing matches are shown with a flag so the user can still pick them (sometimes you want to add a broken workflow to fix it).
- Root defaults to the TUI's launch directory; `Ctrl+Up` lets the user type any absolute path (workflows often live in a checked-out repo outside the launch dir).
- URL tab: plain text input, validates prefix `http(s)://`; on `Enter` the workspace is materialised immediately and added as `[workspace]`.

---

## 3. Run list with filter

Filter active: `suspended`. Single-pane focus on the run list with a status-filter strip.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║ Runs                                                                                                     ║
║──────────────────────────────────────────────────────────────────────────────────────────────────────────║
║   ID         WORKFLOW         STATUS        DURATION   STARTED                 LAST SEQ                  ║
║                                                                                                          ║
║   efgh3478   deploy           ⏸ waiting      12m       2026-04-15 11:51         seq=87                   ║
║ ▶ ijkl56ab   deploy           ⏸ waiting       3m       2026-04-15 12:01         seq=44                   ║
║   mnop78cd   multi-region     ⏸ waiting      47m       2026-04-15 11:16         seq=203                  ║
║                                                                                                          ║
║   3 suspended   (filter: suspended)        [ all / running / suspended / error / complete ]              ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 RUNS  ↑↓ Select  ⏎ Open  r Resume  a Approve   VIEW  s Status-filter  / Search     ? Help   q Quit
```

- Filter strip shows available values; current filter is underscored in the real render.
- `a Approve` appears **only when** the cursor is on a suspended run — this row qualifies.
- `← →` arrows (not shown) cycle filter values without opening a submenu.

---

## 4. Run viewer — mid-run with fan-out

Same **stacked layout** as §1: top half is the step table for this run, bottom half is the tabbed pane (Graph / Detail / Log / Events). Opened by pressing `⏎` on a run row, which zooms in and hides the cross-run table. Cursor is on `deploy-us` (running, attempt 2/3). Shows two parallel children under a fan-out plus a `forEach` batch row.

```
╔ WORKFLOWS  RUNS  [ RUN ] ════════════════════════════════════════════════════════════════════════════════════════════════════╗
║ ijkl56ab · multi-region · ▶ running · started 3m ago                              retry budget: deploy-us 1/3 · batch-err 0/2 ║
║                                                                                                                               ║
║   STEP                        STATUS        ATTEMPT    ELAPSED    NOTE                                                        ║
║   build                       ✓ ok          1/1        14s        → next                                                      ║
║   test                        ✓ ok          1/1         9s        → next                                                      ║
║   fan-out                     ▶ running     —          30s        2 children active                                           ║
║     deploy-us                 ▶ running     2/3        21s        ↻ retrying in 4s                                            ║
║ ▶   deploy-eu                 ▶ running     1/3        18s                                                                    ║
║   ⟳ batch [regions]           ▶ running     —          25s        2 / 3   ██████░░░   1 retry · 0 failed                      ║
║   publish                     ⊙ pending     —          —                                                                      ║
║                                                                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║  Graph  [ Detail ]  Log  Events                                                  deploy-eu · script (bash) · seq=198          ║
║                                                                                                                               ║
║    type       script (bash)                        timeout   90s                                                              ║
║    attempt    1 / 3                                exit      —                                                                ║
║    started    12:04:07 (18s ago)                   edge      —                                                                ║
║    local      { region: "eu-west-1", sha: "ab12cd" }                                                                          ║
║    global     { sha: "ab12cd", started: "2026-04-15T12:01:00Z" }                                                              ║
║    last log   seq=198  stdout  applying terraform plan (17/32 resources)                                                      ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 RUN  ↑↓ Step  ⏎ Focus  R Re-run  X Cancel    VIEW  1/2/3/4 Tab  m Graph  f Follow  / Filter    ? Help   q Quit
```

- **Stacked layout mirrors §1 app shell.** Top = step table (one row per token in this run), bottom = tabbed pane. Consistency: the TUI has one layout primitive, used at two zoom levels (all-runs in §1, one-run here).
- **Parent/child via indentation.** `fan-out` is the parent row; `deploy-us` and `deploy-eu` are indented beneath it and currently running. `publish` and the `⟳ batch [regions]` summary row sit at parent depth. There is no phantom third child — `fan-out` has exactly two active children; the `batch` is a separate aggregate row representing a different forEach, not a third fan-out sibling.
- **Columns show only observable state.** `NOTE` holds routing hints (`→ next`), retry countdowns, and batch progress. Removed `"streaming…"` (not an engine event) and `"waiting for upstream"` (a pending token has no upstream-wait status — it's either `pending` or `running` once its incoming edges resolve). Pending rows display an em-dash for fields that don't apply yet.
- **Detail tab** shows the selected step's live context: local/global at the *last emitted* event, plus the most recent log line. The full stream is the `Log` tab (`2`).
- `↻ retrying in 4s` is driven by `step:retry.delayMs` (§3.9). `⟳ batch` progress `2/3` comes from completed child tokens against the batch size.
- Active mode tab is rendered as `[ RUN ]` — answers "what does `WORKFLOWS  RUNS  RUN` mean" (see §5.1): three top-level modes, one always active.

---

## 5. Run viewer — approval pending (modal overlay)

Modal centered over the viewer; background dimmed. Mode pill `[APPROVAL]` in the keybar.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║  run ijkl56ab · multi-region · running · 1 approval pending                                               ║
║──────────────────────────────────────────────────────────────────────────────────────────────────────────║
║  ▼ multi-region                                                                                          ║
║    ├─✓ build            14s   → next                                                                     ║
║    ├─✓ test              9s   → next                                                                     ║
║    │        ┌────────────────────────────────────────────────────────────────┐                           ║
║    ├─⏸ revi │ APPROVAL · review                                              │                           ║
║    └─⊙ publ │                                                                │                           ║
║             │  Confirm production deploy for sha ab12cd?                     │                           ║
║             │  Regions: us, eu, ap.                                          │                           ║
║             │                                                                │                           ║
║             │   ◉ approve        proceed to publish                          │                           ║
║             │   ○ reject         route to rollback handler                   │                           ║
║             │   ○ needs-review   suspend and notify #ops                     │                           ║
║             │                                                                │                           ║
║             │          [ ⏎ Decide ]             [ s Suspend ]                │                           ║
║             └────────────────────────────────────────────────────────────────┘                           ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 [APPROVAL]  ⏎ Decide  s Suspend-for-later      Esc Cancel                          ? Help
```

- `[APPROVAL]` is a **reverse-video mode pill** in real rendering — brand color inverted.
- Selectable options show as `◉` (focused) / `○` (unfocused) radios. `j/k` or arrow keys cycle; `⏎` decides.
- The keybar is almost empty — only approval-scoped actions are shown. Global `q Quit` is replaced by `Esc Cancel` inside modal mode.
- "Suspend" exits the modal without deciding; the run stays `suspended` (§3.6).

---

## 6. Run viewer — failed, retries exhausted

Same **stacked layout** as §1 and §4. Run is terminal (`✗ error`), cursor parked on the failing node `deploy-us`, bottom pane on the `Detail` tab showing exit code + stderr tail. `R Re-run` is the gateway to the resume wizard (§7).

```
╔ WORKFLOWS  RUNS  [ RUN ] ════════════════════════════════════════════════════════════════════════════════════════════════════╗
║ mnop78cd · multi-region · ✗ error · finished 2m ago                               retry budgets: deploy-us 3/3 · batch-err 1/2 ║
║                                                                                                                               ║
║   STEP                        STATUS        ATTEMPT    ELAPSED    NOTE                                                        ║
║   build                       ✓ ok          1/1        14s        → next                                                      ║
║   test                        ✓ ok          1/1         9s        → next                                                      ║
║   fan-out                     ✗ failed      —          34s        1 child failed                                              ║
║ ▶   deploy-us                 ✗ failed      3/3        34s        retries exhausted · edge: fail:max                          ║
║     deploy-eu                 ✓ ok          1/3        18s        → next                                                      ║
║     deploy-ap                 ○ skipped     —          —          upstream failed                                             ║
║   ⟳ batch [regions]           ✗ failed      —          34s        1 / 3   ███░░░░░░   1 ✗ · 0 ⏸                              ║
║   rollback-us                 ⊙ pending     —          —          routed by fail:max, not yet started                         ║
║                                                                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║  Graph  [ Detail ]  Log  Events                                                  deploy-us · script (bash) · seq=214          ║
║                                                                                                                               ║
║    status     ✗ failed (3/3 attempts · exhausted)    exit      1                                                              ║
║    started    12:03:06                               ended     12:03:40                                                       ║
║    timeout    60s                                    edge      fail:max  →  rollback-us                                       ║
║    local      { region: "us-east-1", sha: "ab12cd" }                                                                          ║
║                                                                                                                               ║
║    stderr tail (last 3 lines — `2` or Tab for full log):                                                                      ║
║      ssh: connect timed out                                                                                                   ║
║      error: region us-east unreachable                                                                                        ║
║      retry budget 3/3 exhausted                                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 RUN  ↑↓ Step  R Re-run    VIEW  1/2/3/4 Tab  / Filter  w Wrap      ? Help   q Back
```

- **Layout is identical to §1/§4** — only content and statuses differ. One layout primitive, reused across states.
- Failed row `deploy-us` rendered red in real terminal output. Parent `fan-out` inherits the failed status because a child failed and routed the parent's exit via `fail:max`.
- `deploy-ap` is `○ skipped`, not failed — its upstream (the fan-out node) ended in failure before it was scheduled.
- `rollback-us` is `⊙ pending` because the engine routed along `fail:max` to it but the run terminated before the scheduler picked it up (terminal-run on exhausted retry budget). In a future run, resuming here re-enters `rollback-us`.
- Keybar has no `X Cancel` (run already terminal) and no `a Approve` (no pending approvals) — hide-don't-grey. Only `R Re-run` and view controls remain relevant.
- `R Re-run` opens the resume wizard (§7) pre-populated with `deploy-us` selected for `--rerun`.

---

## 7. Resume wizard

Modal over the run viewer. Failing node preselected in the `--rerun` list; inputs editable.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                                          ║
║    ┌──────────────────────────────────────────────────────────────────────────────────────┐              ║
║    │ RESUME · run mnop78cd · multi-region                                                 │              ║
║    │──────────────────────────────────────────────────────────────────────────────────────│              ║
║    │ status:       ✗ error     last event: seq=203  retry:exhausted at deploy-us          │              ║
║    │ started:      2026-04-15 11:16                                                       │              ║
║    │                                                                                      │              ║
║    │ Nodes to re-run                                                                      │              ║
║    │   [x] deploy-us       (failed, 3/3 attempts)                                         │              ║
║    │   [ ] deploy-eu       (complete 18s)                                                 │              ║
║    │   [ ] test            (complete 9s)                                                  │              ║
║    │   [ ] build           (complete 14s)                                                 │              ║
║    │                                                                                      │              ║
║    │ Inputs (audit-logged)                                                                │              ║
║    │   sha       = ab12cd          →  ab12cd                                              │              ║
║    │   regions   = us,eu,ap        →  [us,eu,ap__]                                        │              ║
║    │   timeout   = 60s             →  [120s_____]   ← edited                              │              ║
║    │                                                                                      │              ║
║    │ 1 re-run · 1 input changed                                                           │              ║
║    │                                                                                      │              ║
║    │         [ ⏎ Resume ]          [ p Preview events ]          [ Esc Cancel ]           │              ║
║    └──────────────────────────────────────────────────────────────────────────────────────┘              ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 [RESUME]  ⏎ Resume  Space Toggle  Tab Next field  p Preview      Esc Cancel                        ? Help
```

- `[RESUME]` mode pill; reverse video in real rendering.
- `← edited` annotation on `timeout`: edits are visibly marked before confirmation (transparency).
- `Preview events` opens a diff-style view of what events the resume will append — non-MVP but reserved.

---

## 8. Log pane focused — follow on

Log pane at bottom becomes full-height when focused (`5` jump or `o` from node).

```
╔ Log · deploy-us · follow · seq=148 ══════════════════════════════════════════════════════════════════════╗
║ 12:03:11  seq=140  stdout  connecting to region us-east                                                  ║
║ 12:03:12  seq=141  stdout  key fingerprint ed25519 ab:cd:ef...                                           ║
║ 12:03:15  seq=142  stderr  warn: slow link us-east                                                       ║
║ 12:03:21  seq=143  stdout  uploading 42 MB                                                               ║
║ 12:03:34  seq=144  stdout  uploaded 42 MB in 13s                                                         ║
║ 12:03:35  seq=145  stdout  running post-install                                                          ║
║ 12:03:42  seq=146  stderr  error: migration "0042_backfill" timeout                                      ║
║ 12:03:43  seq=147  stderr  retrying in 4s                                                                ║
║ 12:03:47  seq=148  stdout  retry attempt 2 starting                                                   ⏵  ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 LOG · following   w Wrap  t Timestamps  1 stdout  2 stderr  3 both  / Search      Esc Back to graph
```

- `⏵` at the right edge = "live tail, more incoming" indicator.
- Stream labels (`stdout` / `stderr`) render in two different colors; stderr lines bold-red in real rendering.
- Seq column is stable — the same `seq` value appears next to the corresponding node row in the graph pane.

---

## 9. Log pane paused — scrolled into history

User scrolled up; follow-mode auto-pauses (lazydocker pattern, features.md §3.5). "PAUSED" banner fixed at the top.

```
╔ Log · deploy-us · PAUSED · seq cursor=143 / head=218 ═════════════════════════════════════════════════════╗
║  ⏸ PAUSED — press F to resume following  ·  75 new lines since pause                                     ║
║──────────────────────────────────────────────────────────────────────────────────────────────────────────║
║ 12:03:11  seq=140  stdout  connecting to region us-east                                                  ║
║ 12:03:12  seq=141  stdout  key fingerprint ed25519 ab:cd:ef...                                           ║
║ 12:03:15  seq=142  stderr  warn: slow link us-east                                                       ║
║ 12:03:21  seq=143  stdout  uploading 42 MB                                          ← cursor             ║
║ 12:03:34  seq=144  stdout  uploaded 42 MB in 13s                                                         ║
║ 12:03:35  seq=145  stdout  running post-install                                                          ║
║ 12:03:42  seq=146  stderr  error: migration "0042_backfill" timeout                                      ║
║ 12:03:43  seq=147  stderr  retrying in 4s                                                                ║
║ 12:03:47  seq=148  stdout  retry attempt 2 starting                                                      ║
║   ...                                                                                                    ║
║ 12:04:59  seq=217  stdout  post-install complete                                                         ║
║ 12:05:00  seq=218  stdout  deploy-us finished in 1m49s                                                   ║
║                                                                                                          ║
║ ▼ more below — press G to jump to head                                                                   ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 LOG · paused   F Resume follow  G Jump to head  g Jump to top  w Wrap  / Search      Esc Back
```

- Paused banner uses a yellow background in real rendering.
- "75 new lines since pause" counter updates live even while paused — no lost messages (§3.5).
- Keybar shows `F Resume follow` (uppercase) to distinguish from `f Follow` toggle elsewhere; destructive unambiguity (§5.6 rule 4).

---

## 10. Command palette overlay (`:`)

Typed `:re` → fuzzy-filtered list of matching commands.

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║  ... run viewer content dimmed ...                                                                       ║
║                                                                                                          ║
║     ┌────────────────────────────────────────────────────────────────────────────────┐                   ║
║     │ :re|                                                                           │                   ║
║     │────────────────────────────────────────────────────────────────────────────────│                   ║
║     │ ▶ :resume <run>              Resume a suspended or failed run                  │                   ║
║     │   :rerun <node>              Re-run a node in the current run                  │                   ║
║     │   :reload                    Reparse the current workflow                      │                   ║
║     │   :restart                   Re-run the entire current run as a new run        │                   ║
║     └────────────────────────────────────────────────────────────────────────────────┘                   ║
║                                                                                                          ║
║  ... rest dimmed ...                                                                                     ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 [COMMAND]   ⏎ Run  ↑↓ Select  Tab Complete      Esc Cancel
```

- Matching characters in each command name are bold-highlighted in real rendering (not shown here).
- First match pre-selected; `⏎` runs it with the typed argument.
- Background is dimmed — typical modal dim of ~40% brightness.

---

## 11. Help overlay (`?`) — context-sensitive

In run-viewer mode. Shows only the bindings active here, grouped by category. Searchable (`/` inside the overlay).

```
╔ WORKFLOWS  RUNS  RUN ════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                                          ║
║    ┌──────────────────────────────────────────────────────────────────────────────────────┐              ║
║    │ HELP · mode: RUN · focus: graph                                         /search      │              ║
║    │──────────────────────────────────────────────────────────────────────────────────────│              ║
║    │ RUN                                                                                  │              ║
║    │   ↑ ↓              select step                                                       │              ║
║    │   ⏎                open logs for selected step                                       │              ║
║    │   a                approve pending decision                    (1 available)         │              ║
║    │   R                re-run selected node                                              │              ║
║    │   r                resume wizard                                                     │              ║
║    │   X                cancel active run                                                 │              ║
║    │                                                                                      │              ║
║    │ VIEW                                                                                 │              ║
║    │   m                toggle mermaid graph overlay                                      │              ║
║    │   f                toggle follow mode                                                │              ║
║    │   /                filter tree                                                       │              ║
║    │                                                                                      │              ║
║    │ GLOBAL                                                                               │              ║
║    │   :                command palette                                                   │              ║
║    │   ?                this help                                                         │              ║
║    │   q                back to run list                                                  │              ║
║    └──────────────────────────────────────────────────────────────────────────────────────┘              ║
║                                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 [HELP]   ↑↓ Navigate   / Search   Esc Close
```

- Disabled hints are **hidden** (§5.6 rule 5). If no approval were pending, the `a` row would be omitted entirely — not shown grey.
- Search filter is scoped to this overlay (`/` highlights matching rows).
- Categories mirror the keybar's inline category labels.

---

## 12. Medium width (~90 cols) — column trimming + tighter tabs

Same stacked layout as §1 — **top half = runs table, bottom half = tabbed pane**. At ~90 cols nothing structural changes; what adapts is inside each half:

- **Top (runs table):** drop low-signal columns (`STARTED` absolute time, `ELAPSED` in favour of a compact `AGE`). Keep `ID · WORKFLOW · STATUS · STEP · NOTE`.
- **Bottom (tabbed pane):** tab labels drop to single letters (`G D L E`), selected tab marked with a caret. Contents reflow to the narrower width.
- **Keybar:** drops to the **short tier** (§5.6 rule 7) — fewer category words, terser labels.

```
╔ WORKFLOWS  RUNS  RUN ══════════════════════════════════════════════════════════════════╗
║ Runs   sort: attention ↓   filter: all · 24h        5 shown · 9 995 arch · a Show all  ║
║                                                                                        ║
║   ID       WORKFLOW    STATUS      STEP        AGE    NOTE                             ║
║ ▶ abcd12   deploy      ▶ running   build 2/3   2:14   ↻ retry 4s                       ║
║   efgh34   deploy      ⏸ waiting   review      —      "confirm prod?"                  ║
║   ijkl56   deploy      ✗ failed    publish     1:52   exit 1 · exhausted               ║
║   mnop78   smoke       ✓ ok        —           48s                                     ║
║   qrst90   ingest      ✓ ok        —           3:12                                    ║
║                                                                                        ║
╠════════════════════════════════════════════════════════════════════════════════════════╣
║  [G]raph  [D]etail  [L]og  [E]vents               abcd12 · deploy · build · seq=142    ║
║                                                                                        ║
║   ▼ deploy-prod                                                                        ║
║     ├─▶ build      12s   attempt 2/3   ↻ retrying · 4s                                 ║
║     ├─✓ test        8s   → next                                                        ║
║     ├─⏸ review     waiting  "confirm prod?"                                            ║
║     └─⊙ publish    pending                                                             ║
║                                                                                        ║
║     ⟳ batch [regions]  3/5  █████░░░                                                   ║
║                                                                                        ║
╚════════════════════════════════════════════════════════════════════════════════════════╝
 RUNS  ↑↓ ⏎ / r X    VIEW  1-4 Tab  m f     ? q
```

- **No layout change** between wide (§1) and medium — only content trims. One layout primitive, responsive by column set and label length, not by rearranging panes.
- Column-drop order (data loss ranking, least important first): `STARTED` absolute time → full `ELAPSED` format → `ATTEMPT` column (fold into `STEP` as `build 2/3`) → `NOTE` truncated with `…`. Never drop `ID`, `STATUS`, or `STEP`.
- Tab labels compress to `[G]raph` etc.; at `<70` cols they become single letters `G D L E` with the active one inverted.
- Keybar shows the **short tier** — category words stay, key labels collapse. Bottom floor is keys-only (see §13).

---

## 13. Narrow width (<60 cols) — one pane at a time + breadcrumb

At <60 cols the stacked layout (§1 / §4 / §6 / §12) collapses to **one pane at a time**: `Runs` table → one run's `Steps` table → focused step detail. The breadcrumb conveys depth and replaces the mode-tab row. Still the same navigation model — just serialised into single pane slices rather than shown simultaneously.

Example below: terminal 52 cols, drilled into run `ijkl56` (the terminal-failed run from §6) and focused on step `deploy-us`.

```
╔ Runs › ijkl56 › deploy-us ══════════════════════╗
║ deploy-us                                        ║
║ ✗ failed · attempt 3/3 · exit 1                  ║
║                                                  ║
║ stderr tail:                                     ║
║   ssh: connect timed out                         ║
║   error: region us-east unreachable              ║
║   retry budget 3/3 exhausted                     ║
║                                                  ║
║ upstream: fan-out (failed)                       ║
║ route:    fail:max  →  rollback-us               ║
║                                                  ║
║ local:  { region: "us-east-1",                   ║
║           sha: "ab12cd" }                        ║
║ global: { sha: "ab12cd",                         ║
║           regions: ["us","eu","ap"] }            ║
╚══════════════════════════════════════════════════╝
 ↑↓ ⏎ R  |  1-4 tab  f /  |  ? q     ? for labels
```

- Three-level drill-down mirrors the two-level stack: `Runs` is the top table; `⏎` opens one run (shows its step table at the same depth); `⏎` again focuses a step (shows its detail — the contents of the Detail tab from §1's bottom pane).
- `1-4 tab` still cycles Graph / Detail / Log / Events at the step-focus level, because the tabbed pane survives — it's just now the whole screen instead of the bottom half.
- Breadcrumb `Runs › ijkl56 › deploy-us` replaces the mode-tab row (§5.4). `Esc` pops one level; `q` exits the top level.
- Keybar is **keys-only** tier (<60 cols, §5.6 rule 7). Right-side hint `? for labels` keeps discoverability.
- Status `upstream: fan-out (failed)` and populated `local` / `global` are kept consistent with §6 (same run, same moment in time).

---

## 14. Monochrome / ASCII-only fallback

Same run as §4, rendered with `--ascii` (or auto-detected from a cp437 terminal). No box-drawing, no emoji glyphs, text-only state labels.

```
+-- WORKFLOWS  RUNS  RUN ---------------------------------------------------------------+
|  run ijkl56ab * multi-region * running * started 3m ago                                |
|---------------------------------------------------------------------------------------|
|  multi-region                                                                          |
|    |- [ok]    build            14s  -> next                                            |
|    |- [ok]    test               9s  -> next                                            |
|    |- [run]   fan-out                                                                  |
|    |    |- [run]   deploy-us    21s   attempt 2/3   [retry] in 4s                      |
|    |    |- [run]   deploy-eu    18s   streaming...                                     |
|    |    `- [wait]  deploy-ap    pending (waiting for upstream)                         |
|    |- [batch] regions 2/3 ###### ...                                                   |
|    `- [wait]  publish           pending                                                |
|                                                                                        |
|  retry budgets:  deploy-us  1/3  *  batch-errors  0/2                                  |
+----------------------------------------------------------------------------------------+
 RUN  Up/Dn Step  Enter Logs  a Approve  R Re-run  X Cancel   VIEW  f Follow  / Filter   ? q
```

- Glyphs replaced with bracketed text states (`[run] [ok] [fail] [wait] [batch] [retry]`).
- Box-drawing replaced with `+-|` ASCII. Tree joiners use pipes and backticks.
- Color annotations below mocks don't apply here — monochrome is the hard constraint (for screen-reader users and legacy terminals).

---

## 15. Mode / width matrix — keybar strings

Condensed reference: what the keybar actually says in each (mode × width) combination. Use this to sanity-check any future rebindings.

| Mode        | ≥100 cols                                                                    | 60–100 cols                                       | <60 cols                        |
|-------------|------------------------------------------------------------------------------|---------------------------------------------------|---------------------------------|
| WORKFLOWS   | `↑↓ Select  ⏎ Open  r Run  e Edit in $EDITOR     ? Help   q Quit`            | `↑↓ ⏎ r e    ? q`                                 | `↑↓ ⏎ r e ?`                    |
| RUNS        | `↑↓ Select  ⏎ Open  r Resume  a Approve   s Status  / Search     ? q`        | `↑↓ ⏎ r a  s /   ? q`                             | `↑↓ ⏎ r a ?`                    |
| RUN (graph) | `↑↓ Step  ⏎ Logs  a Approve  R Re-run  X Cancel   VIEW  m  f  /    ? q`      | `↑↓ ⏎ a R X   m f /    ? q`                       | `↑↓ ⏎ R X  \| f /  \| ? q`      |
| LOG (follow)| `LOG · following   w Wrap  t Timestamps  1/2/3 streams  / Search    Esc`     | `LOG follow  w t 1/2/3 /   Esc`                   | `w t /   Esc`                   |
| LOG (paused)| `LOG · paused   F Resume  G Head  g Top  w Wrap  / Search    Esc`            | `LOG paused  F G g w /   Esc`                     | `F G g w /  Esc`                |
| APPROVAL    | `[APPROVAL]  ⏎ Decide  e Edit inputs  s Suspend-for-later    Esc Cancel  ?`  | `[APPROVAL] ⏎ e s   Esc ?`                        | `⏎ e s   Esc`                   |
| RESUME      | `[RESUME]  ⏎ Resume  Space Toggle  Tab Next  p Preview    Esc    ?`          | `[RESUME] ⏎ Space Tab p   Esc ?`                  | `⏎ Space Tab p  Esc`            |
| COMMAND (`:`)| `[COMMAND]   ⏎ Run  ↑↓ Select  Tab Complete    Esc Cancel`                  | `⏎ ↑↓ Tab   Esc`                                  | `⏎ ↑↓ Tab  Esc`                 |
| FIND (`^P`) | `[FIND]   ⏎ Open  ↑↓ Select    Esc Cancel`                                   | `⏎ ↑↓   Esc`                                      | `⏎ ↑↓  Esc`                     |
| HELP (`?`)  | `[HELP]   ↑↓ Navigate   / Search   Esc Close`                                | `↑↓ / Esc`                                        | `↑↓ / Esc`                      |

- Rows obey the three-tier fallback from features.md §5.6. The `<60` column is pure keys-only with a `press ? for labels` right-side hint (omitted here for density).
- `X` always paired with confirm-modal (§3.8) — never a one-keystroke destructive.
- Toggle-label flips (`Follow` ↔ `Unfollow`) only render in the full tier; the short/keys tier shows just the key.

---

*End of mockups. Cross-reference `features.md` for rationale, `testing.md` for how these screens become E2E fixtures.*
