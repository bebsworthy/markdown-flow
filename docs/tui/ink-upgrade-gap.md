# TUI Ink 7 / React 19 / @inkjs/ui 2.x — Upgrade Gap Report

Diagnostic review of `packages/markflow-tui/` against the two playbooks:

- Ink 7: `docs/tui-ink-playbook.md`
- `@inkjs/ui` 2.x: `docs/tui-ink-ui-playbook.md`

Stack context (from `packages/markflow-tui/package.json`): `ink ^7.0.1`, `react ^19.2.5`, `@inkjs/ui ^2.0.0`, `ink-testing-library ^4.0.0`. Root `package.json` has no React pin. Test run: **363 failed / 1301 passed / 49 test files failed** (vitest, `npm run test -w markflow-tui`).

---

## 1. Summary

| # | Gap | Severity | Affected | Fix shape |
|---|---|---|---|---|
| G1 | Dual React / dual Ink in hoisted `node_modules` (React 18.3.1 + ink 5.2.1 pulled in by `@inkjs/ui@2.0.0` transitive; ink-testing-library resolves them instead of the workspace-local Ink 7 / React 19) | **Blocker** | All test runs (`Objects are not valid as a React child` crashes) | Workspace-level `overrides` / `resolutions` pinning `react@19.2.5`, `ink@7.0.1`, or remove `@inkjs/ui` dep (unused in src) |
| G2 | `@inkjs/ui` declared as dependency but never imported in `src/**` | Major | `package.json:22`, `tsup.config.ts:16` | Remove from `dependencies` and `external`, or adopt it properly per §3.7 |
| G3 | `ink-testing-library@4.0.0` pre-dates Ink 7 (declares `engines.node >=18`, no React 19 peer range) | Blocker (for tests) | All component tests | Verify upstream support; may need a fork / patch / newer pre-release. Playbook §"Testing" flags this exact risk |
| G4 | Missing `engines.node >=22` and React 19.2+ peer contract in `packages/markflow-tui/package.json` | Major | `packages/markflow-tui/package.json` | Add `"engines": { "node": ">=22" }` per Ink 7 playbook §"Stack baseline" |
| G5 | `key.delete` treated as "erase previous char" alongside `key.backspace` — now the forward-Delete key erases chars | Minor | 9 call sites across 8 components (see G5) | Remove `|| key.delete` from input-erase branches |
| G6 | Manual `useStdout().stdout.columns` / `.rows` reads instead of `useWindowSize()` | Minor | `src/app.tsx:209,1053,1057,1060,1061,1074,1075`; comments in keybar.tsx, runs-table.tsx, step-table.tsx | Swap to `useWindowSize()` — re-renders on SIGWINCH automatically |
| G7 | Keybar width overflow at width=90 (93 cols rendered) | Major (visual; not Ink-upgrade-related but flagged by suite) | `src/components/keybar.tsx`, 10 fixture cases | Likely pre-existing width math; investigate separately |
| G8 | No `key.meta && !key.escape` guards found — clean | n/a | — | — |
| G9 | No `measureElement` / manual SIGWINCH listeners — clean | n/a | — | — |
| G10 | `useCallback` wrappers in `app.tsx` (≥7 sites) — redundant under Ink 7 but harmless | Minor | `src/app.tsx:306,321,377,400,432,445,459` | Optional cleanup; not required |

Severity scale: **Blocker** (prevents tests/build), **Major** (runtime / semantic defect), **Minor** (cosmetic / cleanup).

---

## 2. Findings

### G1 — Dual React / dual Ink via `@inkjs/ui` transitive (BLOCKER)

**Playbook:** Ink 7 playbook, "Stack baseline": *"Ink 7 requires Node.js 22+ and React 19.2+. Mixing older React versions in the same tree will break."* Also §"Re-mounting vs. `cleanup()`" and React 19 §"StrictMode".

**Evidence** — `npm ls react -w markflow-tui --all`:

```
markflow-tui@0.0.0
├─┬ @inkjs/ui@2.0.0
│ └─┬ ink@5.2.1
│   ├─┬ react-reconciler@0.29.2
│   │ └── react@18.3.1 deduped
│   └── react@18.3.1
├─┬ ink@7.0.1
│ ├─┬ react-reconciler@0.33.0
│ │ └── react@19.2.5 deduped
│ └── react@19.2.5 deduped
└── react@19.2.5
```

Both `ink@5.2.1` and `react@18.3.1` are **hoisted to the monorepo root** (`/Users/boyd/wip/markdown-flow/node_modules/ink/package.json` → `"version": "5.2.1"`, `/Users/boyd/wip/markdown-flow/node_modules/react/package.json` → `"version": "18.3.1"`). The workspace-local copies (`packages/markflow-tui/node_modules/ink` = 7.0.1, `packages/markflow-tui/node_modules/react` = 19.2.5) only resolve for code inside that workspace's own imports.

`ink-testing-library@4.0.0` has no nested `node_modules/`, so its internal `import 'ink'` resolves to the **hoisted** `ink@5.2.1` (which itself pulls `react@18.3.1`). Meanwhile test files import `ink` and `react` from `markflow-tui` and get 7.0.1 / 19.2.5. The runtime ends up with two copies of React, whose internal `$$typeof` Symbols don't match — every test that renders any React element crashes with:

```
ERROR Objects are not valid as a React child (found: object with keys
      {$$typeof, type, key, props, _owner, _store}). If you meant to render a
      collection of children, use an array instead.
```

Example test expecting `"false:false:[ok]"` that dumps this stack: `test/theme/context.test.tsx:25`.

**Blast radius:** ~300+ of 363 failing tests show this exact error signature. Sampled: `test/hooks/useSidecarStream.test.tsx:116`, `test/theme/context.test.tsx:25, 34`, `test/app/approval-overlay.test.tsx:*`, `test/app/command-palette.test.tsx:*`, `test/app/mode-transitions.test.tsx:*`, etc.

**Expected pattern (playbook):** single React, single Ink, everything on the Ink 7 / React 19 line. Enforce via root `overrides`:

```jsonc
// root package.json
"overrides": {
  "react": "19.2.5",
  "react-dom": "19.2.5",
  "ink": "7.0.1"
}
```

…or, because `@inkjs/ui` isn't imported anywhere, just **drop the dep** (see G2).

---

### G2 — `@inkjs/ui` declared but unused

**Playbook:** `@inkjs/ui` 2.x playbook §1 (peer `ink: ">=5"` — still satisfied against ink 7 at resolver level, but the library's own lockfile pulls ink 5).

**Evidence:** `Grep` for any import of `@inkjs/ui` across `packages/markflow-tui/src/**` and `test/**` returns **zero hits**. The only references are:

- `packages/markflow-tui/package.json:22` — `"@inkjs/ui": "^2.0.0"` in `dependencies`
- `packages/markflow-tui/tsup.config.ts:16` — listed in `external`

No component uses `<Badge>`, `<StatusMessage>`, `<Alert>`, `<Spinner>`, `<Select>`, `<ProgressBar>`, etc. `<ThemeProvider>` in the codebase is the TUI's own (`src/theme/context.tsx`), not `@inkjs/ui`'s.

**Blast radius:** none functionally; removing the dep eliminates G1's transitive ink 5 / react 18 chain.

---

### G3 — `ink-testing-library@4.0.0` lag (BLOCKER for tests)

**Playbook:** Ink 7 playbook §"Testing": *"`ink-testing-library` historically lagged Ink majors. Verify its peer ranges match Ink 7 / React 19.2 before assuming a test failure is your bug."*

**Evidence:** `node_modules/ink-testing-library/package.json` — version `4.0.0`, `engines.node >=18` only, no React or Ink peer pin. Combined with G1, it resolves against the hoisted ink 5. Even if G1 is fixed via `overrides`, whether `ink-testing-library@4.0.0` internally works under ink 7 + React 19 is unverified — the `Objects are not valid as a React child` message may persist if the library's `render()` trampoline is still using React 18 primitives.

**Remediation shape:** upstream check (github releases), possibly patch or await 5.x release.

---

### G4 — Engine contract absent in `package.json`

**Playbook:** Ink 7 playbook "Stack baseline".

**Evidence:** `packages/markflow-tui/package.json` has no `"engines"` field. Root `package.json` likewise has none. Current Node is `v24.13.1` locally so things run, but CI / fresh installs won't enforce Node 22.

**Fix:** add to `packages/markflow-tui/package.json`:

```json
"engines": { "node": ">=22" }
```

---

### G5 — `key.delete` erases characters alongside `key.backspace`

**Playbook:** Ink 7 playbook §"Known gotchas" #1: *"`key.backspace` is what typing Backspace emits. `key.delete` is the forward-delete key."* In Ink 5/6 `key.delete` fired for Backspace (the bug). Code written for Ink 5 used `if (key.delete) eraseChar()`. Post-bump that code now erases on the **forward-Delete** key as well, which is rarely the intended semantics (Delete usually means "delete character under cursor" or "delete next").

**Affected sites** (all use `key.backspace || key.delete`):

| File | Line |
|---|---|
| `packages/markflow-tui/src/components/command-palette-modal.tsx` | 122 |
| `packages/markflow-tui/src/components/add-workflow-modal.tsx` | 277, 320, 376 |
| `packages/markflow-tui/src/components/events-panel-view.tsx` | 168 |
| `packages/markflow-tui/src/components/resume-wizard-modal.tsx` | 138 |
| `packages/markflow-tui/src/components/help-overlay.tsx` | 78 |
| `packages/markflow-tui/src/components/runs-filter-bar.tsx` | 65 |
| `packages/markflow-tui/src/components/input-prompt-modal.tsx` | 140 |

**Current pattern:**

```ts
if (key.backspace || key.delete) {
  if (query.length === 0) return;
  onQueryChange(query.slice(0, -1));
  ...
}
```

**Expected pattern:** drop `|| key.delete` unless the component explicitly wants forward-delete-also-erases. These look like Ink-5-era habits (backspace was reported as `key.delete`). After Ink 7, **just `key.backspace` is the correct guard**.

**Blast radius:** 9 call sites. Semantic change, not a crash — forward-Delete currently duplicates Backspace's behavior.

---

### G6 — Manual `stdout.columns` / `stdout.rows` reads

**Playbook:** Ink 7 playbook §"useWindowSize": *"`{ columns, rows }`. Re-renders on SIGWINCH. Prefer this over reading `process.stdout.columns` yourself."*

**Current:** `src/app.tsx:209` reads `const { stdout } = useStdout();` then at line 1053 `const frameWidth = stdout?.columns ?? 80;`, feeding `stdout?.columns` / `stdout?.rows` into `<AppShell>` on lines 1057, 1060, 1061, 1074, 1075. These values are a **snapshot at mount/re-render** — they do not re-read on SIGWINCH.

Comments in `keybar.tsx:29,84`, `runs-table.tsx:31`, `step-table.tsx:13`, `app-shell.tsx:24,101,106` all reference `useStdout().stdout.columns` as the intended source. None of them subscribe to resize events.

**Expected pattern:**

```tsx
const { columns, rows } = useWindowSize();
// ...
<AppShell width={columns} height={rows} ... />
```

**Blast radius:** 1 primary reader (`app.tsx`), plus every downstream consumer through the `width` / `height` props. Going via `useWindowSize()` is a drop-in replacement.

---

### G7 — Keybar width overflow at width=90 (93 chars rendered)

**Evidence:** `test/components/keybar-fixtures/matrix-90.test.tsx:171` — `expect(line.length).toBeLessThanOrEqual(90)` fails with `expected 93 to be less than or equal to 90` across 10 fixture variants (WORKFLOWS_EMPTY, GRAPH, LOG_FOLLOWING, LOG_PAUSED, EVENTS_FOLLOWING, EVENTS_PAUSED, APPROVAL, RESUME, COMMAND, HELP).

This looks like off-by-3 layout math, **not** directly attributable to the Ink bump — it could be pre-existing, or a subtle width-calc regression from Yoga's behavior change in Ink 7. File: `src/components/keybar.tsx`. Investigate separately from the Ink upgrade.

**Blast radius:** 10 fixture tests; 1 source file.

---

### G8 — `key.meta && !key.escape` guards (none found)

**Playbook:** Ink 7 playbook §"Escape fix". Grep for `key.meta` on Escape paths.

**Evidence:** `Grep key.meta` in src returns 9 occurrences, **all** of the form `input && !key.ctrl && !key.meta` — used as filter guards on text-input branches to reject modifier combos. None guard Escape. Clean; no migration needed.

---

### G9 — Manual `measureElement` / SIGWINCH listeners (none found)

**Playbook:** Ink 7 playbook §"useBoxMetrics".

**Evidence:** `Grep measureElement|SIGWINCH` in src → no matches. Only the stdout-snapshot pattern of G6.

---

### G10 — Redundant `useCallback` wrappers

**Playbook:** Ink 7 playbook §"useInput callback stability": *"you can remove `useCallback` wrappers used only to calm Ink 5."*

**Evidence:** `src/app.tsx` lines 306, 321, 377, 400, 432, 445, 459 — all wrap closures in `useCallback`. Several of these are passed to children as props (legitimate React memoization reason) and several just sit on the component (legacy). Low priority cleanup.

---

## 3. Test failure correlation

Sampled failing tests mapped to gaps:

| Test file / case | Observed error | Root gap |
|---|---|---|
| `test/theme/context.test.tsx:25` (reads ASCII+mono theme) | `Objects are not valid as a React child` | G1 (dual React) |
| `test/theme/context.test.tsx:34` (unicode theme) | same | G1 |
| `test/theme/context.test.tsx:53` (throws outside provider) | `caught` stays null — render never threw because the dual-React crash happened first | G1 |
| `test/hooks/useSidecarStream.test.tsx:73` (tail callback) | `expect(onLine).toHaveBeenCalledWith("tail", 0)` — never called | G1 (render throws before effect runs) |
| `test/hooks/useSidecarStream.test.tsx:105` (cancel on unmount) | `expected false to be true` | G1 (effect never ran) |
| `test/hooks/useSidecarStream.test.tsx:116` (error state) | `lastFrame` shows the `Objects are not valid` stack | G1 |
| `test/components/keybar-fixtures/matrix-90.test.tsx` × 10 | `expected 93 ≤ 90` | G7 (pre-existing width math) |
| `test/app/approval-overlay.test.tsx:*`, `command-palette.test.tsx:*`, `mode-transitions.test.tsx:*`, `resume-wizard.test.tsx:*`, `run-entry.test.tsx:*` etc. | crash during render | G1 |

Nearly every failing test that involves rendering (any `render(<…/>)` from `ink-testing-library`) is blocked on G1 + G3. The keybar-width-90 failures (G7) are the only cluster that survives independently of the Ink upgrade and should be investigated on its own.

Gaps not tied to a failing test (but real):

- **G5** (`key.delete`) — no current test asserts forward-Delete should not erase chars; wrong behavior is silent.
- **G6** (window size) — tests inject `width`/`height` props directly on `<AppShell>`, bypassing `useStdout` entirely, so live-resize behavior is untested.
- **G10** (useCallback) — cosmetic.

---

## 4. Remediation order

Do in this order; each step unblocks the next.

1. **G2 / G1 — Dependency hygiene.** Remove `@inkjs/ui` from `packages/markflow-tui/package.json` `dependencies` (and `tsup.config.ts` external list), because it's unimported. Re-install. Confirm `npm ls react -w markflow-tui --all` shows only `react@19.2.5` and `ink@7.0.1`. If a future feature genuinely needs `@inkjs/ui`, re-add it *together* with root-level `overrides` forcing `react@19.2` and `ink@7` so the transitive ink 5 / react 18 never lands.

2. **G3 — Verify `ink-testing-library` works.** Re-run the suite. If the `Objects are not valid as a React child` error persists even with a single React/Ink pair, the library itself is the issue. Check its repo for an ink-7-compatible tag (or patch-package).

3. **G4 — Lock the engine contract.** Add `"engines": { "node": ">=22" }` to `packages/markflow-tui/package.json`. Optional: add it to root too.

4. **G5 — `key.delete` cleanup.** Mechanical s/`key.backspace || key.delete`/`key.backspace`/ across the 9 sites in G5, then add regression tests that assert forward-Delete does *not* erase text.

5. **G6 — Migrate to `useWindowSize()`.** Replace the `useStdout().stdout.columns/rows` reads in `src/app.tsx` with `useWindowSize()` from `ink`. Remove the stale comments in `keybar.tsx`, `runs-table.tsx`, `step-table.tsx`, `app-shell.tsx`.

6. **G7 — Keybar width overflow.** Only then tackle the keybar width=90 math — isolated from the upgrade blast. Likely fixed by auditing the fixture's slot allocation vs. the separator/padding accounting in `keybar.tsx`.

7. **G10 — `useCallback` cleanup.** Lowest priority; cosmetic.

Gaps G8 and G9 require no work — they are clean.

---

## Appendix: files of interest

- `packages/markflow-tui/package.json` — deps + engines
- `packages/markflow-tui/src/app.tsx` — root component, `useStdout` consumer, `useCallback` cluster
- `packages/markflow-tui/src/components/app-shell.tsx` — width/height plumbing
- `packages/markflow-tui/src/theme/context.tsx` — custom ThemeProvider (not `@inkjs/ui`'s)
- `packages/markflow-tui/src/components/{command-palette,add-workflow,events-panel-view,resume-wizard,help-overlay,runs-filter-bar,input-prompt}*.tsx` — `key.delete` sites
- `packages/markflow-tui/src/components/keybar.tsx` — width=90 overflow owner
- Root `/Users/boyd/wip/markdown-flow/node_modules/ink/package.json` (5.2.1) + `/node_modules/react/package.json` (18.3.1) — the hoisted outliers proving G1
