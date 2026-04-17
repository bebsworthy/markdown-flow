# E2E Test Build Instruction

**Important**
You are the e2e orchestrator. Your role is to drive the checklist in
[`docs/tui/e2e-plan.md`](./e2e-plan.md) to green, one test at a time, in
strict TDD red→green style. **Do not reimplement features** — if a test
reveals a product bug, open it as a finding, fix the product code, then
return to the test. The plan is authority; deviations require user
approval.

**Scope.** The 180 tests T0001–T2002 in `e2e-plan.md`. Layer-3 harness
(`packages/markflow-tui/test/e2e/`) — built binary under `node-pty` +
`@xterm/headless`. No mocking the engine or the TUI; every test drives
`dist/cli.js` against a real workspace.

---

## How to resume

The orchestrator never loads the full plan into context. Use these
grep-based queries instead of reading the file:

```bash
# Next pending test (first [ ] row in the table):
grep -nE '^\| T[0-9]{4} \|' docs/tui/e2e-plan.md | grep ' \[ \] ' | head -1

# View one test's row:
grep -nE "^\| T1000 \|" docs/tui/e2e-plan.md

# Show the group heading a test belongs to (scroll up from its line):
awk -v t=T1000 '/^## / {h=$0} $0 ~ t {print h; print; exit}' docs/tui/e2e-plan.md

# Count remaining work in a group:
grep -cE '\[ \]' docs/tui/e2e-plan.md
```

Flip a checkbox when a test is landed and passing in CI (`[ ]` → `[x]`):

```bash
# macOS/BSD sed needs -i '' ; linux uses -i
sed -i '' "s/| T1000 | \(.*\) | \(.*\) | \[ \] |/| T1000 | \1 | \2 | [x] |/" \
  docs/tui/e2e-plan.md
```

Update Appendix B's "Done" counter in the same commit.

---

## Primary references

- [`docs/tui/e2e-plan.md`](./e2e-plan.md) — the 180-test checklist (authority).
- [`docs/tui/features.md`](./features.md) — feature rationale; the plan's
  "Refs" column points here.
- [`docs/tui/mockups.md`](./mockups.md) — visual contract.
- [`docs/tui/testing.md`](./testing.md) — test-layer strategy (harness lives at Layer 3).
- [`packages/markflow-tui/test/e2e/README.md`](../../packages/markflow-tui/test/e2e/README.md)
  — harness + debug knobs (`E2E_DEBUG=1`, `E2E_FRAME_DIR`).
- [`CLAUDE.md`](../../CLAUDE.md) — monorepo conventions.

Never guess at a test's intent — the plan row + its "Refs" cell is the
acceptance criterion. If the row is ambiguous, **ask the user** before
writing it.

---

## Per-test TDD loop

The orchestrator holds only the **test ID** (e.g. `T1000`). For each
open `[ ]` row:

### 1. Triage
- `grep` the row out of `e2e-plan.md`. Read only the row + its group
  heading + the linked "Refs" sections.
- Decide the **layer**:
  - `e2e` — drive the real binary end-to-end (preferred).
  - `e2e-engine` — seed `runs/<id>/events.jsonl` via
    `test/e2e/fixtures/event-log.ts` and attach the TUI (read-only tests,
    historical-run views, anything the real engine can't produce
    deterministically in-process).
- Decide the **fixture**. Either an existing `test/e2e/fixtures/*.md` or
  a new self-contained one. Keep fixtures deterministic: no clocks, no
  network, no randomness.

### 2. Red — write the failing test first
- One test per file, or one test per `describe` block in a shared
  journey file. Do not batch unrelated tests into one file.
- File naming: `test/e2e/T1000-run-entry-no-inputs.e2e.test.ts` (test ID
  in the filename so the plan and the repo stay in lockstep).
- Use the harness API exclusively — no raw `spawn`, no ad-hoc timers:
  - `spawnTui({ scratch, args })`
  - `scratch.writeRegistry([...])` to seed entries before spawn
  - `writeEventLog(scratch.runsDir, { ... })` for `e2e-engine`
  - `session.waitForRegex(re, ms?)` / `snapshotContains(re)` for screen
  - `session.waitForEventLog(runId, minSeq, ms?)` for engine state
  - `session.screen()` for raw buffer, `session.snapshot()` for
    canonicalised
- Every wait is **bounded**. Every timeout carries a post-mortem
  snapshot (the harness already attaches one — do not catch+rethrow
  without it).
- Run the test; confirm it fails for the **expected** reason
  (assertion, not a harness error or a missing fixture).

### 3. Green — make it pass
Two possible paths:
- **Test-only fix** — the product is correct; the test needed a
  different selector, longer timeout inside the bounded budget, or an
  extra setup step. Adjust the test.
- **Product bug** — the feature is broken or missing. Before editing
  product code:
  1. Summarise the bug in one paragraph (what the test saw vs. what the
     spec requires, citing features.md / mockups.md § refs).
  2. Check `./pm pending docs/tui/plan.md` — if the owning task is
     still open, route the fix through the normal phase-workflow
     orchestrator (`docs/tui/instruction.md`), not through this e2e
     loop. The e2e test stays `[ ]` until the phase task closes.
  3. If the task is already `[x]` (regression), fix it here but open a
     follow-up note in `docs/tui/plans/regressions.md` with the test ID
     and a one-line description.

Never disable, skip, or weaken an assertion to make a test green.

### 4. Validate
```bash
npm run lint -w packages/markflow-tui
npm test    -w packages/markflow-tui -- --run
npm run test:e2e -w packages/markflow-tui                                  # all e2e
npx vitest run --config vitest.e2e.config.ts -t "T1000"  \                 # just this one
  -w packages/markflow-tui
```

All four must be green. If a flake is suspected, run the e2e suite 3×
back-to-back — any failure is a fail, flakes are not tolerated
(`docs/tui/testing.md` §5 flake budget: zero).

### 5. Commit
One commit per test (or one commit per tight group of ≤3 related tests
that share a fixture). Commit format:

```
test(tui-e2e): T1000 run entry with zero inputs

- Implements T1000 from docs/tui/e2e-plan.md.
- References: features.md §3.1, §5.7.
- Flips [ ] → [x] in the plan; bumps Appendix B counter.
```

Staged files only — never `git add -A`. The plan file is part of the
same commit.

### 6. Advance
- Flip the checkbox: `sed -i` command above.
- Update Appendix B row for the group (`Done` column +1).
- Move to the next `[ ]` row. Prefer ID order (T0001 → T2002); skip a
  row only if it is explicitly blocked (a B3 audit row, an
  unimplemented feature) and note the skip in the commit message.

---

## Order of attack

The plan is numbered, but not every group is worth the same up-front
cost. Recommended sequence:

1. **Group 1 (T0001–T0013)** — launch & lifecycle. Cheapest; validates
   the harness itself. Any flake here is a harness bug, fix it before
   moving on.
2. **Group 2 (T0100–T0110) + Group 20 (T1900–T1903)** — browser +
   registry persistence. Covered by the existing
   `journey-add-run.e2e.test.ts` journey; extract per-ID asserts from
   there.
3. **Group 11 (T1000–T1015)** — run entry. This is the hole that the
   original bug report exposed. All five A-blockers were fixed
   specifically to unblock this group. Prove the harness works end-to-
   end here first.
4. **Group 4 (T0300–T0314) + Group 5 (T0400–T0409) + Group 6
   (T0500–T0516)** — runs table + step table + tabbed pane. These use
   the `e2e-engine` layer with `writeEventLog` fixtures; write one
   reusable fixture set under `test/e2e/fixtures/seeded/` and reuse.
5. **Group 7 (T0600–T0609) + Group 8 (T0700–T0710)** — approval + resume.
   Event-sourced; `e2e-engine` again.
6. **Group 9 (T0800–T0812)** — palette + help.
7. **Group 17 (T1600–T1605)** — input dispatch. Guards the B3
   regression class; run these on every PR touching `useInput` sites.
8. Everything else, in plan order.

If you find yourself about to write >10 tests in one sitting, stop and
commit first. A green suite halfway is better than a red suite all the
way.

---

## Global rules

- **Harness-only.** No test uses `child_process.spawn`, `execa`, or
  pulls in a second PTY library. Extend `harness.ts` if something is
  missing.
- **No hidden shared state.** Every test calls `createScratchEnv()` (or
  lets `spawnTui` create one) — never reuse a temp dir across tests.
- **No `screen().includes(...)`** for anything involving colour,
  positioning, or unicode glyphs — use `snapshot()` (canonicalised) or
  the xterm cell buffer directly.
- **No `sleep`** outside the bounded poll loop inside `waitFor`.
- **Every test must fail meaningfully.** Delete the assertion that
  catches the feature you're guarding and confirm the test fails;
  restore and confirm it passes. (Mutation test by hand, once per
  test.)
- **macOS / Linux only.** Windows branches are `test.skipIf(process.
  platform === "win32")`.
- **Don't edit `plan.md`.** This e2e loop operates on `e2e-plan.md`. If
  a test reveals a gap in `plan.md`, bounce to
  `docs/tui/instruction.md`'s orchestrator.

---

## Validation gates (every commit)

```bash
npm run lint -w packages/markflow-tui
npm test    -w packages/markflow-tui -- --run
npm run test:e2e -w packages/markflow-tui
```

Engine-side tests only if a bug-fix commit touched `packages/markflow/`:

```bash
npm run lint -w packages/markflow
npm test    -w packages/markflow -- --run
npm run build -w packages/markflow
```

---

## Debug knobs

When a test fails and the canonicalised snapshot isn't enough:

```bash
# Watch the TUI repaint live:
E2E_DEBUG=1 npx vitest run --config vitest.e2e.config.ts -t "T1000" \
  -w packages/markflow-tui

# Dump every waitFor frame:
E2E_FRAME_DIR=/tmp/e2e-frames npx vitest run --config vitest.e2e.config.ts \
  -t "T1000" -w packages/markflow-tui
ls /tmp/e2e-frames  # 0001-ok.txt, 0002-timeout.txt, ...
```

Both are documented in `packages/markflow-tui/test/e2e/README.md`.

---

*Authority: `docs/tui/e2e-plan.md`. Orchestration style cribbed from
`docs/tui/instruction.md`. Workflow: red → green → commit → next.*
