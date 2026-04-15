# E2E Testing of TUIs — Research Report for the markflow Ink TUI

Target audience: engineers building `markflow-tui`, a separate npm package (sibling to the `markflow` CLI in a workspace monorepo — see [features.md §6.5](./features.md)) whose live run viewer is an Ink TUI that subscribes to an `EngineEvent` stream (imported from the `markflow` library) and renders an indented DAG tree with multiple responsive panels.

> **Note on paths in code sketches below.** Written before the CLI / TUI package split was decided. Under the current monorepo layout: TUI source lives at `packages/markflow-tui/src/`, its tests at `packages/markflow-tui/test/`, and engine types are imported from the `markflow` library package (e.g. `import { EngineEvent } from "markflow"`), not via relative paths into `src/core/`. The sketches still illustrate the right patterns — only the imports move.

---

## 1. The TUI testing tool landscape

Testing a TUI is meaningfully harder than testing a web UI because the "DOM" is a rectangular grid of styled cells produced by interpreting a stream of ANSI escape sequences, and because the surface is driven by both *state changes* and *terminal size / capability variance*. The tools below each attack a different layer of this problem.

### microsoft/tui-test — Playwright-style E2E for terminals

`@microsoft/tui-test` is Microsoft's open-source Playwright analogue for terminals. It spawns the system under test in its own PTY, uses an embedded `xterm.js` instance to render the raw bytes into a grid, then exposes a Playwright-like `expect(...).toBeVisible()`, `toMatchSnapshot()`, regex matchers, and auto-wait. Each test gets an isolated terminal context in milliseconds, and every run produces a tracefile that can be replayed with `show-trace` for CI debugging. It works on macOS, Linux and Windows and supports bash/zsh/fish/PowerShell/cmd/git-bash/xonsh. Node 16.6+ through 24.x is supported. ([microsoft/tui-test](https://github.com/microsoft/tui-test), [npm](https://www.npmjs.com/package/@microsoft/tui-test), [DeepWiki](https://deepwiki.com/microsoft/tui-test))

Typical test:

```ts
import { test, expect } from "@microsoft/tui-test";
test.use({ program: { file: "node", args: ["./dist/cli/index.js", "run", "fixtures/hello.md"] }});
test("live viewer shows tree", async ({ terminal }) => {
  await expect(terminal.getByText("build")).toBeVisible();
  await expect(terminal).toMatchSnapshot();
});
```

### tui-devtools — hybrid PTY automation + React DevTools daemon

[`seongsu-kang/tui-devtools`](https://github.com/seongsu-kang/tui-devtools) ([npm](https://www.npmjs.com/package/tui-devtools), v0.1.1 as of March 2026) is a very new but architecturally interesting project explicitly designed for **AI agents driving TUIs**. Two layers in one daemon:

1. **Universal PTY automation** (`node-pty` + `@xterm/headless`): `start`, `run "<cmd>"`, `screenshot [--strip-ansi] [--json]`, `press Enter Tab Ctrl-c`, `type "hello"`, `wait "Ready" --timeout 5000`, `scroll`, `kill-session`. Works with *any* TUI (Ink, Bubble Tea, Ratatui, htop, vim).
2. **React DevTools for Ink apps** (over a WebSocket via `react-devtools-core`, activated when the app sets `DEV=true`): `tree [--depth N] [--json]` returns the component hierarchy, `inspect <name>` returns props/state/hooks, `find <name>` searches by component name, `logs --level error --tail N` returns captured console output.

Architecture: a single background daemon exposes PTY sessions via Unix-socket IPC and the DevTools bridge via WebSocket (port 8097). Multiple daemons (`-s <name>`) and multiple sessions per daemon (`--sid`) allow parallel/isolated runs. Requires Node ≥18 and macOS/Linux (no Windows — ConPTY not supported today).

Why it matters for markflow:
- Fills a gap neither `ink-testing-library` (no real terminal) nor `@microsoft/tui-test` (no React introspection) covers on its own — you can assert *both* "the screen shows `✓ build`" *and* "the `<StepRow id="build"/>` component's `status` prop is `complete`" in the same test.
- CLI-first interface makes it trivially scriptable from any test runner and particularly well-suited to agent-driven exploratory testing.
- Caveats (as of v0.1.1): 5 stars, single contributor, API likely to churn, no Windows support, React DevTools layer requires the target app to bundle `react-devtools-core` and run with `DEV=true`. Treat as a **development/debugging tool** and a source of ideas for an in-house PTY harness, not yet a production CI dependency.

Worth keeping on the radar. If it stabilises, it becomes a strong addition alongside `tui-test` at Layer 4 of §6 — `tui-test` for rigorous E2E, `tui-devtools` for introspective debugging when a test fails.

### ink-testing-library — in-process component tests

Vadim Demedes' `ink-testing-library` is the canonical unit/component harness for Ink apps. `render(<App/>)` returns `{ lastFrame, frames, rerender, unmount, stdin, stdout, stderr }`. `stdin.write("q")` drives `useInput`, `rerender` swaps props, and `lastFrame()` returns the latest composed string. ([ink-testing-library README](https://github.com/vadimdemedes/ink-testing-library), [npm](https://www.npmjs.com/package/ink-testing-library))

The critical limitation: **there is no real terminal**, so Ink's terminal-coupled hooks (`useInput`, `useStdin`, `useStdout`, `useStderr`, `useWindowSize`, `useApp`, `useFocus`, `useFocusManager`) degrade to no-op defaults. They won't throw, but they won't behave like in production. That means focus management, SIGWINCH resize, and raw-mode input must be covered elsewhere. ([Ink hooks docs](https://github.com/vadimdemedes/ink), [Ink 3 release notes](https://vadimdemedes.com/posts/ink-3))

### node-pty — the PTY primitive

`@microsoft/node-pty` forks a child process attached to a pseudoterminal, returning a stream you can `write()` keystrokes to and subscribe to `onData`/`onExit` on. It supports Linux, macOS, and Windows (via ConPTY on 1809+), and is used by VS Code's integrated terminal, Hyper, and `tui-test` itself. It's the building block you reach for when you want homemade integration tests without another framework. ([microsoft/node-pty](https://github.com/microsoft/node-pty), [npm](https://www.npmjs.com/package/node-pty))

### VHS (charmbracelet/vhs) — deterministic tape recorder

VHS executes a `.tape` script in a headless terminal and emits GIF/MP4/WebM/PNG/plain-text. The DSL includes `Type`, `Enter`, `Backspace`, `Tab`, `Ctrl+C`, arrow keys, `Sleep 500ms`, `Wait+Screen /regex/` (with 15s default timeout), `Hide`/`Show`, `Screenshot <path>`, `Set FontSize`, `Set Width/Height`, `Set TypingSpeed`, `Set Theme`, `Set Framerate`, `Env KEY value`, and `Source file.tape`. The `charmbracelet/vhs-action` GitHub Action re-runs tapes in CI and keeps generated demos up to date; the same mechanism doubles as a golden-file integration test because the produced plain-text `.ascii` output is stable and diffable. ([charmbracelet/vhs](https://github.com/charmbracelet/vhs), [vhs-action](https://github.com/charmbracelet/vhs-action))

### teatest + catwalk — Bubble Tea's approach

`teatest` (in `charmbracelet/x/exp/teatest`) drives Bubble Tea models through `NewTestModel`, `Send(msg)`, `WaitFor(predicate, timeout)`, `WaitFinished`, and `RequireEqualOutput` against a golden file. Golden files are updated with a `-update` flag, stored under `testdata/`, and protected with `*.golden -text` in `.gitattributes` so git doesn't rewrite CRLFs. The community tip for CI determinism is `lipgloss.SetColorProfile(termenv.Ascii)` so color-profile autodetection doesn't diverge between a developer laptop and GitHub Actions. ([teatest blog post](https://charm.land/blog/teatest/), [Carlos Becker's teatest guide](https://carlosbecker.com/posts/teatest/), [improvements discussion](https://github.com/charmbracelet/x/discussions/533))

`knz/catwalk` is a complementary unit-test library for Bubble Tea models that uses `datadriven` to store reference `Update`-outputs in a text file; a `-rewrite` flag regenerates the expected output. Supported input directives include `type`, `enter`, and `key`, and the test harness exercises the `Update` function directly without a real terminal. ([knz/catwalk](https://github.com/knz/catwalk))

### Textual Pilot — the Python pattern worth stealing

Textual's `App.run_test()` yields an async `Pilot` object that offers the most ergonomic TUI test API around: `await pilot.press("r")`, multi-key `press("h","e","l","l","o")`, modifier keys `"ctrl+c"`, `pilot.click("#red", times=2, control=True, offset=(10,5))`, and `pilot.pause(delay=0.5)` to flush the message pump. Snapshot testing is provided by `pytest-textual-snapshot`, which captures SVG renders (not raw text) backed by syrupy; update with `pytest --snapshot-update`. ([Textual testing guide](https://textual.textualize.io/guide/testing/), [Pilot API](https://textual.textualize.io/api/pilot/), [pytest-textual-snapshot](https://github.com/Textualize/pytest-textual-snapshot))

Patterns worth stealing for Ink:
- **`pause()` that awaits a message pump** rather than `sleep(n)` — in Ink's case, awaiting a microtask flush + `rerender` tick.
- **CSS-selector-style queries** — even if Ink doesn't do CSS, you can tag components with `testID` props and query `lastFrame` against annotated regions.
- **SVG snapshots** for visual regression — higher fidelity than text snapshots, still text-diffable.

### rexpect / pexpect — scripted expectations

`pexpect` (Python) and `rexpect` (Rust port) follow Don Libes' original Tcl `expect`: `spawn("ssh host")`, `expect("password:")`, `sendline("secret")`, `expect_exact("$ ")`. They match on pattern *after* waiting, which turns timing into a property of the assertion rather than a sleep. Useful when the target is genuinely line-oriented (a REPL, not a full-screen app). Unsuited to apps that repaint with cursor motion. ([pexpect](https://github.com/pexpect/pexpect), [rexpect](https://github.com/rust-cli/rexpect), [Expect (Wikipedia)](https://en.wikipedia.org/wiki/Expect))

### tmux-based E2E — how lazygit tests

Lazygit's integration tests initially used recorded bash sessions with snapshot comparison and found them "great for writing, terrible for maintaining". They rewrote to a Go DSL where `TestDriver` (aliased `t`) combines input injection, focus-aware navigation, and assertions into a single chainable object: `t.Views().Files().Focus().Press(keys.Files.CommitChanges).Tap(...)`. Assertions use matchers (`Contains`, `DoesNotContain`, `Equals`, `MatchesRegex`) against `Lines(...)` so exact whitespace doesn't break tests. Failed CI runs dump the final terminal frame as a visual snapshot for debugging, and tests are auto-discovered via `go generate`. ([More Lazygit Integration Testing](https://jesseduffield.com/More-Lazygit-Integration-Testing/), [Lazygit 5-year retrospective](https://jesseduffield.com/Lazygit-5-Years-On/))

### Playwright + xterm.js — when you already live in a browser

`xterm.js` itself is tested in Playwright across Chromium/Firefox/WebKit by hosting the emulator in a page and driving key input. This is useful if your TUI is already wrapped in a web terminal (e.g., a cloud IDE preview), and `@microsoft/tui-test` essentially productizes this idea. A known caveat: Playwright+WebGL addon doesn't render correctly on Chromium/Firefox, only WebKit. ([xterm.js testing discussion](https://github.com/xtermjs/xterm.js/discussions/5154), [xterm.js dev docs](https://deepwiki.com/xtermjs/xterm.js/8-development-and-testing))

### asciinema + diff

`asciinema` records `.cast` files (JSONL of `[timestamp, stream, data]` tuples) and `asciinema cat` replays raw escape sequences. Several projects use it as "golden cast" regression testing: re-run the CLI, dump, and diff. Handle with care — timestamps and even scroll-region sequences drift, so you almost always need a sanitizer pass. ([asciinema testing thread](https://discourse.asciinema.org/t/using-asciinema-for-testing/923), [asciinema](https://github.com/asciinema/asciinema))

### termshot / charmbracelet/freeze — image regression

`charmbracelet/freeze` renders captured terminal output (or source code) to SVG/PNG/WebP and is often paired with pixel-diff tools (`pixelmatch`, `odiff`) to catch visual regressions that text-snapshot tests miss: padding, double-width glyph breakage, bidi, truncated ellipses. Useful for cross-platform rendering smoke tests but brittle if fonts differ — pin the font-family in CI. ([charmbracelet/freeze](https://github.com/charmbracelet/freeze))

### Also worth knowing

- `ft/test-tui` — a framework explicitly for full-screen apps. ([test-tui](https://github.com/ft/test-tui))
- `raibid-labs/ratatui-testlib` — PTY + Sixel + Bevy ECS integration testing for Rust Ratatui apps. ([ratatui-testlib](https://github.com/raibid-labs/ratatui-testlib))
- `onesuper/tui-use` — runs programs in a PTY through a headless xterm and returns the screen as plain text; useful CI fallback. ([tui-use](https://github.com/onesuper/tui-use))
- `dtinth/headless-terminal` — alternative Node-side xterm emulator. ([headless-terminal](https://github.com/dtinth/headless-terminal))
- `@xterm/headless` — the official, stripped-down, Node-only xterm.js emulator (v6 as of 2026), 149+ downstream projects. This is what you reach for when rolling your own PTY-based tests. ([@xterm/headless](https://www.npmjs.com/package/@xterm/headless))

---

## 2. Best practices for deterministic TUI tests

### Snapshotting

Raw terminal output contains too many moving parts for a byte-exact snapshot. Canonicalize before comparing:

1. **Strip ANSI.** Node 18.17+ ships `util.stripVTControlCharacters`; prefer it over the external `strip-ansi` package. Major projects (Prettier, Vitest, npm CLI, pnpm, Expo) have all migrated. ([Node built-in migration PRs](https://github.com/prettier/prettier/pull/16817), [strip-ansi](https://github.com/chalk/strip-ansi))
2. **Normalize whitespace selectively.** Trim trailing spaces on each line (cells padded to terminal width); preserve intentional alignment.
3. **Mask non-determinism.** Replace timestamps (`\d{2}:\d{2}:\d{2}`), durations (`\d+(ms|s)`), run IDs (UUIDs), absolute file paths, and PIDs with stable placeholders. Spinners are a classic trap — either disable them in test mode or replace `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` with `*`.
4. **Normalize line endings.** Force LF in tests and in golden files. Add `*.snap -text` / `*.golden -text` in `.gitattributes` so git doesn't rewrite on Windows checkouts (the exact issue teatest users hit). ([teatest CI tips](https://charm.land/blog/teatest/))
5. **Quote snapshots.** Wrap the captured string in `"""` or fenced code so trailing whitespace is visible in reviews (Waleed Khan's rule). ([Testing TUI apps](https://blog.waleedkhan.name/testing-tui-apps/))

A Jest/Vitest helper like `@relmify/jest-serializer-strip-ansi` handles step 1 transparently. ([jest-serializer-strip-ansi](https://github.com/relmify/jest-serializer-strip-ansi))

### Input injection

- **Printable characters**: just write bytes. `stdin.write("q")`.
- **Special keys**: terminal programs expect the actual escape sequences. Enter is `\r` (or `\n` in raw mode depending on terminal), Escape is `\x1b`, Arrow Up is `\x1b[A`, Ctrl-C is `\x03`, Ctrl-D is `\x04`. The classic bug is sending `\n` where the app wants `\r` and watching nothing happen. `tui-test` and `ink-testing-library` both accept the raw sequences.
- **Modifier encoding** varies between xterm, modifyOtherKeys, kitty protocol, and legacy. Pin `TERM=xterm-256color` in tests and avoid testing modifier keys that depend on the newer kitty keyboard protocol unless you explicitly opt in.

### Timing and async

Never sleep. Poll with a timeout, or await an event. `tui-test` uses auto-wait, `teatest` has `WaitFor`, `Pilot` has `pause()`, and `vhs` has `Wait+Screen /regex/`. If you must sleep, make it a hard upper bound on a polled assertion, not a guess at how long something takes. Flaky-test surveys put *sleep-based synchronization* at the top of the list of causes. ([Flaky tests guide](https://testdino.com/blog/flaky-tests/), [Avoiding fixed sleeps](https://trunk.io/blog/how-to-avoid-and-detect-flaky-tests-in-vitest))

### Resize (SIGWINCH)

Ink's `useWindowSize` re-renders on terminal resize. In integration tests with `node-pty`, call `pty.resize(cols, rows)` and assert the new layout. `tui-test` exposes `terminal.resize()`. For unit tests, `ink-testing-library` does not simulate SIGWINCH because there's no real stdout — test responsive components by accepting `width`/`height` as props and exercising them directly. Known caveat: some terminals leave ghost lines when narrowing (an Ink/log-update rendering-model limitation, not a bug). ([Ink issue #153 — resize](https://github.com/vadimdemedes/ink/issues/153), [Ink issue #359 — flicker on resize](https://github.com/vadimdemedes/ink/issues/359))

### Cross-platform line endings

Keep golden snapshots LF-only; tell git hands-off with `.gitattributes`. CRLF creeps in through Windows PTYs — the `conpty` backend can produce different spacing than macOS/Linux. Either run cross-platform CI and maintain per-platform goldens, or declare macOS/Linux primary and run smoke tests on Windows.

### Color and styling assertions

Two schools. Either (a) **strip ANSI** and assert only textual content (fast, portable, loses visual regressions), or (b) **keep ANSI** and assert against a serialized `{text, fg, bg, bold, underline}` per cell. The `@xterm/headless` terminal buffer is the most ergonomic way to get option (b) in Node — step through the pty output, then read `term.buffer.active.getLine(y).getCell(x)`.

For Bubble Tea/Lipgloss, override the color profile (`termenv.Ascii`) so CI and laptop agree. For Ink/chalk, set `FORCE_COLOR=0` or `FORCE_COLOR=3` as a fixed baseline; leaving it unset gives you autodetection — the opposite of what you want.

### Responsive layout testing

Test at a canonical small (80x24), medium (120x40), and large (200x60) width. Force those sizes — don't inherit the host terminal. Ink apps that use flexbox will shrink panels asymmetrically; regressing "panel collapses into a single column at 80 cols" is a common need. `tui-test` and `Pilot` both accept a terminal size option.

### Long-running event streams

For an event-sourced viewer like markflow's, drive the component with a **canned event stream** rather than a live engine. The viewer becomes a pure `(events[]) → frame` function you can snapshot at every `n`-th event. Also test (a) backpressure — what happens when 1000 events arrive in a tight loop?, (b) late events — what if `step:stdout` arrives after `step:complete`?, and (c) truncation — how does the tree degrade when height is exceeded?

---

## 3. Ink-specific considerations

### Hard limits of ink-testing-library

- Terminal-coupled hooks no-op: `useInput`, `useStdin` (beyond the injected stream), `useStdout`, `useStderr`, `useWindowSize`, `useApp`, `useFocus`, `useFocusManager`. Features that depend on them (focus traps, tab cycling, raw-mode escape handling, resize reflow) need either a node-pty-based integration test or a mocked context provider. ([Ink hooks reference](https://github.com/vadimdemedes/ink))
- No clear-screen or alt-screen semantics. `lastFrame()` is the **composed** output, so you can't tell whether Ink cleared the screen, wrote over an old row, or used the alternate screen buffer. If you need that, route through a real PTY.
- No frame-rate / flicker assertions. The `frames` array captures every re-render but gives you wall-time-free snapshots. The flicker that users see on terminals without double-buffering (log-update erases and rewrites every row) is invisible to ink-testing-library. ([Ink flicker issue](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md), [Signature Flicker post-mortem](https://steipete.me/posts/2025/signature-flicker))

### How the big Ink CLIs test their TUIs

**Gemini CLI (Google, Ink + TypeScript)** uses `ink-testing-library` for component tests, but the maintainers have publicly acknowledged it "only validates text content". They are actively tracking visual regression — issue #11462 ("Consider adding visual regression testing for terminal UI components") and issue #9176 ("feat: Visual Testing Implementation") discuss adding pixel-perfect snapshot testing on top of Ink because subtle layout breakage, cross-platform differences, and color-scheme issues slip through text assertions. They also keep a layered `integration-tests/`, `memory-tests/`, `perf-tests/` split and run the built binary end-to-end in a controlled env. ([Visual regression RFC](https://github.com/google-gemini/gemini-cli/issues/11462), [Visual testing implementation](https://github.com/google-gemini/gemini-cli/issues/9176), [gemini-cli repo](https://github.com/google-gemini/gemini-cli))

**Claude Code (Anthropic)** started on Ink and eventually rewrote the renderer because Ink "didn't support the kind of fine-grained incremental updates needed for a long-running interactive UI" — while keeping React as the component model. The lesson: Ink's full-redraw model stresses long-lived, event-stream-driven TUIs exactly like markflow's. That motivates putting heavier integration tests behind a real PTY. ([Signature Flicker post-mortem covers the history](https://steipete.me/posts/2025/signature-flicker))

**Wrangler (Cloudflare)**'s public Workers-Vitest integration is for Worker runtime code rather than its CLI's Ink UI, so there's no public TUI-testing playbook from them. ([Cloudflare Vitest integration](https://blog.cloudflare.com/workers-vitest-integration/))

### Snapshot format choices for Ink

1. **Plain text via `lastFrame()`** — cheap, but loses color/style.
2. **Text + ANSI** — full fidelity, but churns on cosmetic changes.
3. **Serialized cell grid** from `@xterm/headless` — keeps style, diffs nicely, portable across platforms.
4. **SVG via `freeze`** — pixel-stable review artifact, great for reviews but slow to maintain.

Recommendation: default to (1) for component tests, add (3) for a handful of "canonical view" integration tests that catch styling regressions, use (4) sparingly for docs-as-tests.

### Testing alt-screen / flicker / async effects

- **Alt screen**: use a real PTY, assert on the sequence `\x1b[?1049h` entering and `\x1b[?1049l` exiting. `ink-testing-library` can't see these.
- **Flicker**: measure `frames.length` across a state transition. If a single `setState` produces >1 extra frame, you have redundant renders.
- **Async effects** (`useEffect` with an `EngineEvent` subscription): drive the event-stream mock synchronously in the test (`mockEngine.emit(evt)`) and `await` a microtask (`await Promise.resolve()`) before reading `lastFrame()`. Use `vi.useFakeTimers()` to pin any `setTimeout`-based debouncing.

---

## 4. CI considerations

### PTY allocation on GitHub Actions

GitHub Actions runners do **not** allocate a TTY by default — `tty` returns "not a tty" because stdin is not attached to a terminal, and most TUI apps will detect this and disable interactive mode. Options: ([actions/runner #241](https://github.com/actions/runner/issues/241))

1. **Use `node-pty` or `tui-test`** — they create their own PTYs on top of openpty/ConPTY and don't depend on the runner's stdio.
2. **Wrap in `script -q /dev/null`** (Linux) or `script -q /dev/null $cmd` (macOS, different flags) to fake a TTY — works for line-oriented tests, not full-screen.
3. **Run under tmux** — `tmux new-session -d -s t 'your-cmd'; tmux send-keys -t t 'q' Enter; tmux capture-pane -pt t` is the approach `lazygit`-style harnesses use before wrapping in a DSL.

### Determinism

- **Freeze time.** Inject a `now()` function, or use `vi.useFakeTimers({ now: new Date('2024-01-01') })`. Durations and log timestamps leak into every snapshot otherwise.
- **Seed randomness.** If any UI element uses `Math.random` (spinner phase, noise), seed it or mock it.
- **Disable animations.** Spinners, typing effects, blinking cursors. Accept an `animate=false` prop or check `process.env.MARKFLOW_TEST=1`.
- **Pin `TERM`.** Export `TERM=xterm-256color` and `COLORTERM=truecolor` (or unset `COLORTERM`) uniformly.
- **Pin `FORCE_COLOR`.** Either `0` (test monochrome) or `3` (test truecolor). Don't autodetect.
- **Pin rows/cols.** Pass explicit dimensions to the PTY; don't use the runner's default.

### Parallelization

`tui-test` creates a new PTY per test in milliseconds and parallelizes safely. Vitest + `ink-testing-library` parallelizes too, but beware of shared module-level state (`process.env`, singletons). Use `test.concurrent.each` carefully; use `beforeEach` to reset any chalk/Ink colors.

Snapshot updating in CI: never auto-update. Fail the job and have developers run `vitest -u` locally.

---

## 5. Anti-patterns

1. **Exact-byte snapshots of raw ANSI output.** Breaks on every cosmetic change (color tweak, border glyph swap, reorder of style codes that visually renders identically). Always canonicalize first.
2. **Over-snapshotting.** One snapshot per test is almost always too many. Prefer targeted string assertions on the rendered frame (`expect(lastFrame()).toContain("step:build")`) and reserve full-frame snapshots for a handful of "canonical view" tests. The lazygit post-mortem is exactly about this: snapshots "great for writing, terrible for maintaining". ([Lazygit testing history](https://jesseduffield.com/More-Lazygit-Integration-Testing/))
3. **Implementation-detail tests.** Asserting that a component renders `<Box>` + `<Text>` couples tests to Ink internals. Assert on the *rendered frame* — that's the user contract.
4. **Race conditions from fixed sleeps.** `setTimeout(500)` is the primary flake source. Use auto-wait / poll-with-timeout / event-driven barriers. ([Flaky tests survey](https://testdino.com/blog/flaky-tests/))
5. **Keyboard-state leaks.** `stdin.write("\x1b")` at end-of-test that a later test inherits. Always tear down: unmount the app, reset mocks, drain stdin.
6. **Relying on host terminal size.** If `process.stdout.columns` leaks in, your snapshots depend on the developer's laptop.
7. **Color profile autodetection in CI.** The single most reported source of CI-only failures in `lipgloss`/`chalk` ecosystems.
8. **Coupling to wall-clock time.** Durations, `Date.now()`, and heartbeat timestamps rendered anywhere inside the snapshot. Mask or freeze.
9. **Silent truncation when frame exceeds terminal height.** Ink quietly clips; assertions on "the last line" become flaky depending on rows. Either cap rows to a known value or assert on content, not position.
10. **Using `expect(...).toMatchInlineSnapshot()` for anything with ANSI.** The inline snapshot format itself mangles escape codes. Use external snapshots.

---

## 6. Recommended stack for markflow

The target surface is the live run viewer: it subscribes to an `EngineEvent` stream (from `src/core/types.ts`), folds it through a `replay()`-like reducer (from `src/core/replay.ts`) into a snapshot, and renders an indented DAG tree plus status panels. That decomposition maps cleanly onto a four-layer test stack, with a fifth (visual) optional.

### Layer 1 — Unit: pure reducer on canned event streams

No Ink at all. Test that `events[] → viewModel` is deterministic, complete, and idempotent.

```ts
// test/tui/view-model.test.ts
import { describe, it, expect } from "vitest";
import { buildViewModel } from "../../src/tui/view-model.js";
import type { EngineEvent } from "../../src/core/types.js";

const events: EngineEvent[] = [
  { seq: 1, t: 0, type: "run:start",  runId: "r1", workflow: "hello.md" },
  { seq: 2, t: 1, type: "step:start", runId: "r1", step: "build" },
  { seq: 3, t: 2, type: "step:stdout", runId: "r1", step: "build", chunk: "hello\n" },
  { seq: 4, t: 3, type: "step:complete", runId: "r1", step: "build", exit: 0 },
];

describe("view-model", () => {
  it("folds events into a DAG tree snapshot", () => {
    const vm = buildViewModel(events);
    expect(vm.nodes.get("build")).toMatchObject({
      status: "complete",
      exit: 0,
      stdoutTail: ["hello"],
    });
  });

  it("is order-preserving and idempotent", () => {
    const a = buildViewModel(events);
    const b = buildViewModel([...events, ...events.slice(-1)]);
    expect(b.nodes.get("build")!.exit).toBe(a.nodes.get("build")!.exit);
  });
});
```

### Layer 2 — Component: ink-testing-library snapshots

Render the viewer with an injected event stream, strip ANSI, assert on text.

```ts
// test/tui/run-viewer.test.tsx
import { render } from "ink-testing-library";
import { stripVTControlCharacters } from "node:util";
import { RunViewer } from "../../src/tui/run-viewer.js";
import { makeEventStream } from "../fixtures/events.js";

test("indents nested DAG steps", async () => {
  const stream = makeEventStream("fixtures/parallel-fanout.jsonl");
  const { lastFrame, stdin, unmount } = render(<RunViewer stream={stream} width={80} height={24} />);

  await stream.drainAllSync();           // flush canned events synchronously
  await Promise.resolve();               // flush microtasks for useEffect

  const frame = stripVTControlCharacters(lastFrame()!);
  expect(frame).toContain("▶ build");
  expect(frame).toMatch(/^ {2}✔ lint/m);      // indented child
  expect(frame).toMatch(/^ {2}✔ test/m);
  expect(frame).toMatchSnapshot();            // canonicalized snapshot

  stdin.write("q");
  unmount();
});
```

Accept `width`/`height` as props so resize is a pure function of input. Mock `Date.now` + spinners off for determinism.

### Layer 3 — Integration: node-pty driving the real binary

Spawn the built CLI under a PTY, feed a fixture workflow, read a screen buffer via `@xterm/headless`.

```ts
// test/tui/integration/run-viewer.int.test.ts
import * as pty from "node-pty";
import { Terminal } from "@xterm/headless";

test("live viewer shows completed DAG", async () => {
  const term = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
  const p = pty.spawn("node", ["./dist/cli/index.js", "run", "test/fixtures/foreach.md"], {
    name: "xterm-256color",
    cols: 120, rows: 40,
    env: { ...process.env, FORCE_COLOR: "0", MARKFLOW_TEST: "1", TZ: "UTC" },
  });
  p.onData(d => term.write(d));

  await waitUntil(() => screenText(term).includes("run:complete"), 10_000);

  const snap = canonicalize(screenText(term));
  expect(snap).toMatchSnapshot();
  p.kill();
});

function screenText(t: Terminal) {
  const lines: string[] = [];
  for (let y = 0; y < t.rows; y++) lines.push(t.buffer.active.getLine(y)!.translateToString(true));
  return lines.join("\n");
}
```

`waitUntil` is a simple polling helper; never `setTimeout`. `canonicalize` masks timestamps/paths/run IDs.

### Layer 4 — E2E: `@microsoft/tui-test`

Reserve for a small number of "user journey" tests: start a run, watch it stream, press `q`, confirm exit. **Companion tool for debugging** failing L4 tests: [`tui-devtools`](https://github.com/seongsu-kang/tui-devtools) lets you `screenshot`, `tree`, and `inspect` the running Ink app from a separate shell — pair it with `DEV=true` in the test harness while iterating, then remove the env var for deterministic CI runs.

```ts
// test/tui/e2e/user-journey.test.ts
import { test, expect } from "@microsoft/tui-test";

test.use({
  program: { file: "node", args: ["./dist/cli/index.js", "run", "examples/demo.md"] },
  columns: 120, rows: 40,
});

test("user quits mid-run with q", async ({ terminal }) => {
  await expect(terminal.getByText(/▶ build/)).toBeVisible();
  terminal.keyPress("q");
  await expect(terminal.getByText(/run suspended/i)).toBeVisible();
  await expect(terminal).toMatchSnapshot("suspended-state");
});
```

### Layer 5 — Visual regression (optional)

A handful of canonical scenes rendered through VHS into plain `.ascii` files, checked in as golden:

```tape
# docs/testing/run-viewer.tape
Output docs/testing/run-viewer.ascii
Set Shell "bash"
Set Width 120
Set Height 40
Set FontSize 14
Env FORCE_COLOR "0"
Env MARKFLOW_TEST "1"
Type "node ./dist/cli/index.js run examples/demo.md"
Enter
Wait+Screen /run:complete/
```

CI diffs the regenerated `.ascii` against the committed golden via `charmbracelet/vhs-action`. Because it's text, it reviews cleanly in PRs. ([vhs-action](https://github.com/charmbracelet/vhs-action))

### How to split coverage across layers

| Concern | L1 reducer | L2 ink-testing | L3 node-pty | L4 tui-test | L5 VHS |
|---|---|---|---|---|---|
| Event fold correctness | Primary | | | | |
| Rendering text/layout | | Primary | Secondary | | |
| Colors, borders, styles | | | Primary | Secondary | Tertiary |
| Keyboard / focus | | Partial | Primary | Secondary | |
| SIGWINCH / resize | | Partial (prop) | Primary | | |
| Alt-screen / flicker | | | Primary | Secondary | |
| User journeys | | | | Primary | |
| Docs-as-tests | | | | | Primary |

Run L1/L2 on every commit, L3 on PR, L4 on merge, L5 nightly.

---

## 7. Open questions and risks for markflow

1. **Event-stream replay timing.** `replay()` is synchronous, but the viewer will `subscribe` via a Node stream. Ink's React scheduler can batch renders; if the reducer is called per-event but the view commits per-tick, a snapshot taken too early observes a half-updated tree. Resolution: expose a `flush()` on the stream adapter for tests, or use `vi.advanceTimersByTime`.
2. **Long-running stream backpressure.** The engine could emit thousands of `step:stdout` chunks per second. If the viewer stores them all, snapshots blow up. Decide on truncation (last N lines per step) and test it explicitly.
3. **Late/out-of-order events in resume mode.** `resume` replays historical events then attaches live. What happens if a `step:stdout` for step "build" arrives *after* `step:complete` for "build" because the sidecar file is still flushing? The tree might re-open a completed node. Write a test for this.
4. **Color profile drift between dev and CI.** markflow inherits chalk/Ink color autodetection. Pin `FORCE_COLOR` in `vitest.config.ts` and in the GitHub Actions workflow.
5. **Windows PTY differences.** `node-pty` uses ConPTY on Windows, which handles cursor motion slightly differently. Either maintain per-platform golden files or declare macOS+Linux primary.
6. **Ink full-redraw model vs. long-lived viewer.** The Claude Code team rewrote the renderer exactly because Ink's "erase-all-rewrite-all" approach causes flicker in long-running interactive UIs. This is a real risk for markflow if the run view is the top-level screen for hours. Plan a switch to an alt-screen + incremental-update renderer (or a Claude-style custom renderer) as an option — and test both behind a feature flag. ([Ink flicker](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md))
7. **Testing `fail:max` / approval-suspend flows.** These are stateful transitions across many events; they belong in L3 (node-pty) where the engine's actual file-writing and suspend logic runs.
8. **Test-mode env var discipline.** If `MARKFLOW_TEST=1` disables animations, make sure it doesn't accidentally disable a production code path. Audit every branch that reads it.
9. **Focus management.** If the viewer adds interactive panels (a step detail sidebar, scrollback), `useFocusManager` is required and cannot be tested with `ink-testing-library`. Budget for L3 coverage from day one.
10. **Asciinema vs. VHS for docs-as-tests.** Asciinema is more accurate (timings included) but harder to diff; VHS is synthetic but stable. For regression purposes VHS wins; for user-facing demos, both have a place.

---

## 8. Sources

**Frameworks and libraries**
- [microsoft/tui-test (GitHub)](https://github.com/microsoft/tui-test)
- [microsoft/tui-test (npm)](https://www.npmjs.com/package/@microsoft/tui-test)
- [microsoft/tui-test (DeepWiki)](https://deepwiki.com/microsoft/tui-test)
- [vadimdemedes/ink-testing-library](https://github.com/vadimdemedes/ink-testing-library)
- [ink-testing-library (npm)](https://www.npmjs.com/package/ink-testing-library)
- [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- [Ink 3 release notes](https://vadimdemedes.com/posts/ink-3)
- [microsoft/node-pty](https://github.com/microsoft/node-pty)
- [node-pty (npm)](https://www.npmjs.com/package/node-pty)
- [charmbracelet/vhs](https://github.com/charmbracelet/vhs)
- [charmbracelet/vhs-action](https://github.com/charmbracelet/vhs-action)
- [charmbracelet/freeze](https://github.com/charmbracelet/freeze)
- [charmbracelet/x teatest discussion](https://github.com/charmbracelet/x/discussions/533)
- [knz/catwalk (Bubble Tea unit tests)](https://github.com/knz/catwalk)
- [Textual testing guide](https://textual.textualize.io/guide/testing/)
- [Textual Pilot API](https://textual.textualize.io/api/pilot/)
- [Textualize/pytest-textual-snapshot](https://github.com/Textualize/pytest-textual-snapshot)
- [pexpect](https://github.com/pexpect/pexpect)
- [rust-cli/rexpect](https://github.com/rust-cli/rexpect)
- [Expect (Wikipedia)](https://en.wikipedia.org/wiki/Expect)
- [@xterm/headless (npm)](https://www.npmjs.com/package/@xterm/headless)
- [xtermjs/xterm.js dev & testing](https://deepwiki.com/xtermjs/xterm.js/8-development-and-testing)
- [Playwright docs](https://playwright.dev/docs/test-cli)
- [asciinema](https://github.com/asciinema/asciinema)
- [asciinema testing thread](https://discourse.asciinema.org/t/using-asciinema-for-testing/923)
- [ft/test-tui](https://github.com/ft/test-tui)
- [onesuper/tui-use](https://github.com/onesuper/tui-use)
- [raibid-labs/ratatui-testlib](https://github.com/raibid-labs/ratatui-testlib)
- [dtinth/headless-terminal](https://github.com/dtinth/headless-terminal)

**Case studies and deep dives**
- [Writing Bubble Tea Tests — Carlos Becker](https://carlosbecker.com/posts/teatest/)
- [Writing Bubble Tea Tests — Charm](https://charm.land/blog/teatest/)
- [More Lazygit Integration Testing](https://jesseduffield.com/More-Lazygit-Integration-Testing/)
- [Lazygit 5-year retrospective](https://jesseduffield.com/Lazygit-5-Years-On/)
- [Testing TUI apps — Waleed Khan](https://blog.waleedkhan.name/testing-tui-apps/)
- [The Signature Flicker — Peter Steinberger (Claude Code renderer history)](https://steipete.me/posts/2025/signature-flicker)
- [Ink flicker analysis](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md)
- [Ink issue #153 — SIGWINCH / resize](https://github.com/vadimdemedes/ink/issues/153)
- [Ink issue #359 — flicker on long views](https://github.com/vadimdemedes/ink/issues/359)
- [Gemini CLI visual regression RFC #11462](https://github.com/google-gemini/gemini-cli/issues/11462)
- [Gemini CLI visual testing implementation #9176](https://github.com/google-gemini/gemini-cli/issues/9176)
- [Gemini CLI repo](https://github.com/google-gemini/gemini-cli)
- [Cloudflare Workers Vitest integration](https://blog.cloudflare.com/workers-vitest-integration/)
- [GitHub Actions runner #241 — not a tty](https://github.com/actions/runner/issues/241)

**ANSI, determinism, and anti-patterns**
- [chalk/strip-ansi](https://github.com/chalk/strip-ansi)
- [Prettier migration to `util.stripVTControlCharacters`](https://github.com/prettier/prettier/pull/16817)
- [pnpm migration](https://github.com/pnpm/pnpm/pull/9009)
- [stylelint migration thread](https://github.com/stylelint/stylelint/issues/8017/linked_closing_reference?reference_location=REPO_ISSUES_INDEX)
- [relmify/jest-serializer-strip-ansi](https://github.com/relmify/jest-serializer-strip-ansi)
- [ANSI escape code (Wikipedia)](https://en.wikipedia.org/wiki/ANSI_escape_code)
- [Flaky Tests Complete Guide — TestDino](https://testdino.com/blog/flaky-tests/)
- [Avoid flaky tests in Vitest — Trunk](https://trunk.io/blog/how-to-avoid-and-detect-flaky-tests-in-vitest)
- [Software Testing Anti-patterns — Codepipes](https://blog.codepipes.com/testing/software-testing-antipatterns.html)

**Primary docs**
- [Ink API & hooks](https://github.com/vadimdemedes/ink)
- [Vitest snapshot testing](https://vitest.dev/guide/snapshot)

