# TUI Library Upgrade Gap Analysis

Audit of `packages/markflow-tui/` against:
- `docs/tui-ink-playbook.md` (Ink 7 / React 19)
- `docs/tui-ink-testing-playbook.md` (ink-testing-library 4.x)
- `docs/tui-xterm-headless-playbook.md` (@xterm/headless 6.x)

Scope: source in `src/`, component/unit tests in `test/` (excl. e2e), e2e harness in `test/e2e/`.

---

## 1. Ink 7 Source Gaps

### G1 — `key.meta` used where `key.escape` is needed (P0)

Ink 7 no longer sets `key.meta: true` for bare Esc — only `key.escape: true`.
Every `!key.meta` guard that filters out Esc-modified input is now a no-op
against plain Escape, letting Esc keypresses leak into text-input handlers.

| # | File | Line | Code |
|---|------|------|------|
| 1 | `src/components/add-workflow-modal.tsx` | 282 | `!key.ctrl && !key.meta` |
| 2 | `src/components/add-workflow-modal.tsx` | 328 | `!key.ctrl && !key.meta` |
| 3 | `src/components/add-workflow-modal.tsx` | 381 | `!key.ctrl && !key.meta` |
| 4 | `src/components/events-panel-view.tsx` | 173 | `!key.ctrl && !key.meta` |
| 5 | `src/components/resume-wizard-modal.tsx` | 146 | `!key.ctrl && !key.meta` |
| 6 | `src/components/command-palette-modal.tsx` | 128 | `!key.ctrl && !key.meta` |
| 7 | `src/components/runs-filter-bar.tsx` | 85 | `!key.ctrl && !key.meta` |
| 8 | `src/components/input-prompt-modal.tsx` | 148 | `!key.ctrl && !key.meta` |
| 9 | `src/components/help-overlay.tsx` | 84 | `!key.ctrl && !key.meta` |

**Fix:** Replace every `!key.meta` with `!key.escape` in these guards.

### G2 — Missing `flexShrink={0}` on fixed-width elements (P1)

Ink 7 defaults `flexShrink` to 1. Fixed-width containers will collapse under
a constrained parent unless they opt out.

| File | Line | Element |
|------|------|---------|
| `src/components/workflow-browser.tsx` | 227 | `<Box width={1}>` divider |

No `flexShrink` is used anywhere in the codebase. Other fixed-width boxes may
be protected by their parent geometry, but the divider is in a flex row and
can shrink to zero.

**Fix:** Add `flexShrink={0}` to the divider. Audit any other `width={N}` box
inside a flex row.

### G3 — Manual alternate-screen instead of `render()` option (P2)

`cli.tsx:39-42` manually writes `\x1b[?1049h` / `\x1b[?1049l` around the Ink
`render()` call and manages restore in the `.then()`/`.catch()` of
`waitUntilExit()`. Ink 7 provides `alternateScreen: true` natively, which
handles all edge cases (signal teardown, concurrent mode, etc.).

The manual approach works today but bypasses Ink's cleanup integration.

**Fix:** Pass `{ alternateScreen: true }` to `render()` and remove the manual
escape writes. Keep the `MARKFLOW_TEST` env guard by conditionalizing the
option.

### G4 — No issues (clean)

The following Ink 7 rules were checked and found compliant:

- **Backspace vs Delete** — all handlers use `key.backspace`; no `key.delete` misuse.
- **useCallback on useInput** — none found; handlers are passed directly.
- **forwardRef** — not used anywhere.
- **Box inside Text** — no violations.
- **useBoxMetrics / measureElement** — neither used; sizing is prop-driven.
- **useFocus ids** — `useFocus` not used directly (focus handled at app level).
- **Concurrent mode + Suspense** — no Suspense in the tree.
- **useWindowSize** — correctly used in `app.tsx:208`.
- **Number children** — all wrapped in `<Text>`.
- **Direct stdout writes** — only in `cli.tsx` outside the React lifecycle (see G3).

---

## 2. ink-testing-library Test Gaps

### G5 — Multi-character `stdin.write()` without per-char loop (P1)

The playbook states: one `stdin.write()` = one `useInput` invocation. Writing
`"alpha"` fires the handler once with `input === "alpha"`, not five times. If
the handler expects single characters (text-input fields), the test must loop
with a flush between each character.

| # | File | Line | Write |
|---|------|------|-------|
| 1 | `test/components/runs-filter-bar.test.tsx` | 221 | `"abc"` |
| 2 | `test/components/add-workflow-modal.test.tsx` | 213 | `"alpha"` |
| 3 | `test/components/add-workflow-modal.test.tsx` | 273 | `"/some/path.md"` |
| 4 | `test/components/add-workflow-modal.test.tsx` | 296 | `"https://example.com/flow.md"` |
| 5 | `test/components/add-workflow-modal.test.tsx` | 318 | `"https://example.com/flow.md"` |

A `type()` helper already exists in `test/app/run-entry.test.tsx`. These
tests should adopt the same pattern.

**Fix:** Replace each multi-char write with:
```ts
for (const ch of "alpha") { stdin.write(ch); await flush(); }
```

### G6 — No issues (clean)

The following testing rules were checked and found compliant:

- **flush() before/after writes** — consistently present.
- **Key byte constants** — match the playbook cheatsheet.
- **ANSI snapshot assertions** — none; all use `stripAnsi` + `toContain`/`toMatch`.
- **ThemeProvider wrapper** — present on every component render.
- **ink render() in tests** — the 5 width-test files that import from `ink`
  directly are justified (custom stdout for configurable columns).
- **Global cleanup** — not used; per-test `unmount()` where needed.
- **Fake timers** — `log-panel-view.test.tsx` correctly excludes `setImmediate`.
- **flush() implementation** — `test/helpers/flush.ts` uses `setImmediate` with
  default `n=6`.
- **vitest imports** — all explicit.
- **ESM .js extensions** — consistently used.

---

## 3. @xterm/headless E2E Gaps

### G7 — Raw `setTimeout` sleeps instead of `waitFor` polling (P1)

The playbook warns: "don't rely on timers" — use poll-until-text. Several
tests use arbitrary `setTimeout` delays before snapshotting, which is
flake-prone and slower than necessary.

| # | File | Line | Delay |
|---|------|------|-------|
| 1 | `test/e2e/T0103-parse-error-badge.e2e.test.ts` | 103 | 100 ms |
| 2 | `test/e2e/T0105-preview-invalid-entry.e2e.test.ts` | 113 | 200 ms |
| 3 | `test/e2e/T0108-e-noop-safe.e2e.test.ts` | 88 | 300 ms |
| 4 | `test/e2e/T0008-no-save.e2e.test.ts` | 61 | 500 ms |

**Fix:** Replace each `setTimeout` with `session.waitFor(predicate, timeout)`
or `session.waitForText(expected, timeout)`.

### G8 — No issues (clean)

The following xterm/headless rules were checked and found compliant:

- **Import style** — `harness.ts:13` uses `import xtermHeadless from "@xterm/headless"` with destructuring.
- **allowProposedApi** — `true` at `harness.ts:132`.
- **scrollback** — `0` at `harness.ts:133`.
- **trimRight** — `translateToString(true)` at `harness.ts:163`.
- **Resize order** — PTY first, then terminal at `harness.ts:309-310`.
- **Dispose + kill order** — `child.kill()` before `term.dispose()` at `harness.ts:268/278`.
- **No removed v6 options** — no `windowsMode` or `fastScrollModifier`.
- **No DOM addons** — none loaded.
- **No term.onData loopback** — only `child.onData → term.write` (one-way).
- **convertEol** — not set (defaults to `false`).
- **Windows skip** — every test block uses `.skipIf(process.platform === "win32")`.

---

## Summary

| ID | Layer | Severity | Count | Description |
|----|-------|----------|-------|-------------|
| G1 | Ink 7 source | P0 | 9 | `key.meta` → `key.escape` in text-input guards |
| G2 | Ink 7 source | P1 | 1+ | Missing `flexShrink={0}` on fixed-width elements |
| G3 | Ink 7 source | P2 | 1 | Manual alt-screen; use `render({ alternateScreen })` |
| G5 | Tests | P1 | 5 | Multi-char `stdin.write` without per-char loop |
| G7 | E2E | P1 | 4 | Raw `setTimeout` sleeps instead of `waitFor` polling |

**Total: 20 individual findings across 5 gap categories.**

P0 items (G1) will cause user-visible bugs — Escape key leaks into text
fields. P1 items are correctness/flake risks. P2 is a hardening opportunity.
