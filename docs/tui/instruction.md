# Build Instruction

**Important**
You are the task orchestrator your primary role is to spawn agents with the minimum information necessary to perform their tasks. **You do not read the plan file, feature files, mockups, or testing guidelines** instead you use the command below to read and update information.

**How to resume.**

Do not read the whole plan file. Use the repo-root `pm` script (see `pm --help`) to query and mutate it:

```bash
./pm docs/tui/plan.md                     # list every phase + task with line numbers
./pm pending docs/tui/plan.md             # same, but hide fully-completed phases/tasks
./pm task next docs/tui/plan.md           # phase line + next [ ] task line
./pm task view P6-T2 docs/tui/plan.md     # phase line + task heading + task body
./pm task complete P6-T2 docs/tui/plan.md # flip [ ] → [x]
./pm task pending  P6-T2 docs/tui/plan.md # flip [x] → [ ]
```

Workflow:
1. `./pm task next docs/tui/plan.md` to identify the next `[ ]` task ID.
2. Spawn agents with the **ID only** — each agent runs `./pm task view <ID> docs/tui/plan.md` itself to load the body. The orchestrator never loads the task body into its own context.
3. After validation + verifier sign-off, `./pm task complete <ID> docs/tui/plan.md` to mark it done.

The orchestrator is responsible for keeping checkboxes accurate — always flip them through `pm`, never by hand-editing `plan.md`. The orchestrator never loads the task body itself; agents do that via `pm task view`.

**Primary references** (every task should cite the relevant sections rather than paraphrase):

- [`docs/ui/plan.md`](./plan.md) — Phase and task list
- [`docs/tui/features.md`](./features.md) — feature list (§3), IA / layouts / keybar (§5), technical approach (§6), required engine API additions (§7).
- [`docs/tui/mockups.md`](./mockups.md) — 15 ASCII mockups, one per screen/state.
- [`docs/tui/testing.md`](./testing.md) — test-layer strategy (unit / ink-testing-library / node-pty / VHS).
- [`CLAUDE.md`](../../CLAUDE.md) — engine architecture & conventions.

Any deviation from these specs must be discussed with the user before proceeding — **the plan is not authority to redesign**.

---

## Orchestration protocol

The orchestrator (main session) does **not** implement tasks itself. For each open task it runs this loop:

### Per-task loop

The orchestrator only ever holds the **task ID** (e.g. `P6-T2`). Each agent prompt instructs the agent to run `./pm task view <ID> docs/tui/plan.md` as its first action to load the task body verbatim, plus links to `features.md` / `mockups.md` for deeper spec reading. The orchestrator does not review the plan with the user — the Plan agent is expected to make the best decisions within spec and record them as part of the plan file.

1. **Plan** — spawn a *Plan* agent (general-purpose) with the task ID + spec links. The agent loads the body via `pm task view` and produces a concrete technical plan saved to `docs/tui/plans/<task-id>.md` covering:
   - files to create / modify (absolute paths)
   - exported names + signatures
   - data-flow diagram if non-trivial
   - test matrix (what each test file covers)
   - explicit acceptance criteria lifted verbatim from plan.md + any derived sub-criteria
   - **design decisions & rationale** — any choice not fully pinned down by features.md/mockups.md is made here (best judgment within spec) and recorded with its reasoning. No user round-trip.
   - open questions only if a spec is genuinely ambiguous and no defensible default exists; these block the task until resolved.
2. **Implement** — spawn an *Implementation* agent (general-purpose) with:
   - the task ID (agent loads the body via `./pm task view <ID> docs/tui/plan.md`)
   - the technical plan path from step 1 (`docs/tui/plans/<task-id>.md`)
   - explicit scope limits ("do not touch files outside the allow-list")
3. **Validate** — run the commands in the task's "Validation" block (or the default Validation gates below if the task has none). If any fail, return to step 2 with the failure output.
4. **Verify against spec** — spawn a *Verifier* agent (general-purpose) with the task ID + the list of changed files. The verifier loads acceptance criteria via `./pm task view <ID> docs/tui/plan.md`, reads `features.md` / `mockups.md`, and reports whether the implementation matches. If it reports gaps, return to step 2.
5. **Commit** — once validation passes and the verifier signs off, stage only the files the task touched and commit with the convention in §Commit conventions below. Mark the task done with `./pm task complete <ID> docs/tui/plan.md` and move on.

### Agents

| Role | Kind | Typical tools |
|---|---|---|
| Plan | `general-purpose` | Read, Grep, Glob, Write |
| Implementation | `general-purpose` | Read, Edit, Write, Bash, Grep, Glob |
| Verifier | `general-purpose` | Read, Grep, Glob, Bash |

Each agent prompt must include the task ID, an instruction to load the body with `./pm task view <ID> docs/tui/plan.md`, and links to the relevant spec sections. The body loaded from `pm` *is* the acceptance criteria — agents must treat it as verbatim spec. Agents should **never** be told to "figure it out" — specs are authoritative; if a spec is ambiguous, the agent returns a question.

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

