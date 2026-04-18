# ink-testing-library Playbook

Lookup reference for writing and debugging component tests for `markflow-tui`
(ink 7 + react 19 + vitest 4 + `ink-testing-library` 4.x). Not a tutorial.

- Upstream: <https://github.com/vadimdemedes/ink-testing-library>
- Source is tiny (~60 LOC). Read `node_modules/ink-testing-library/build/index.js`
  when in doubt — it's the ground truth.
- In-repo reference tests:
  - `packages/markflow-tui/test/components/approval-modal.test.tsx` — canonical modal + keys + async submit
  - `packages/markflow-tui/test/components/runs-table.test.tsx` — arrow/page keys, cursor routing
  - `packages/markflow-tui/test/components/log-panel-view.test.tsx` — rerender, unmount teardown, fake timers
  - `packages/markflow-tui/test/components/help-overlay.test.tsx` — search-mode typing
  - `packages/markflow-tui/test/app/mode-transitions.test.tsx` — full `<App>` key-driven transitions

---

## 1. `render()` — what you get back

```ts
const r = render(<MyComponent />);
// r:
r.lastFrame(): string | undefined   // shortcut for r.stdout.lastFrame()
r.frames: string[]                  // alias of r.stdout.frames
r.rerender(tree: ReactElement): void
r.unmount(): void
r.cleanup(): void                   // unmount+cleanup (rarely needed per-test)
r.stdout: { lastFrame(), frames, columns (=100), EventEmitter }
r.stderr: { lastFrame(), frames }
r.stdin:  { write(string), isTTY=true, setRawMode()=noop, read(), EventEmitter }
```

Internals worth knowing (from `build/index.js`):

- `render()` calls ink's real `render()` with `debug: true` (synchronous frame
  writes, no reconciler throttling), `exitOnCtrlC: false`, `patchConsole: false`.
- `stdout.columns` is hard-coded to **100**. You cannot resize — do
  layout/width tests by passing explicit `width` props (pattern used throughout
  our components) or escalate to the pty e2e harness.
- `stdin.isTTY = true` and `setRawMode()` is a no-op, so `useInput` works
  without the raw-mode warning Ink normally emits on non-TTY stdin.
- `stdin.write(data)` sets `this.data = data` then synchronously emits
  `'readable'` and `'data'`. Each write **replaces** buffered data rather than
  appending — don't rely on batching two writes into one keystroke.

## 2. Driving input: `stdin.write()`

Ink's `useInput` reads bytes on the next tick after the `'readable'` event, so
you need a microtask flush between the write and assertions.

```ts
await flush();              // let effects attach useInput listener
stdin.write("\r");          // Enter
await flush();              // let useInput handler run + React commit
```

### Key-byte cheatsheet

```ts
const ENTER      = "\r";
const ESC        = "\x1b";
const TAB        = "\t";
const BACKSPACE  = "\x7f";         // Ink treats DEL as backspace
const CTRL_C     = "\x03";         // exitOnCtrlC is off, you'll see it in useInput
const SPACE      = " ";

// Cursor / arrow keys (CSI sequences)
const UP_ARROW   = "\x1b[A";
const DOWN_ARROW = "\x1b[B";
const RIGHT      = "\x1b[C";
const LEFT       = "\x1b[D";

// Paging
const PAGE_UP    = "\x1b[5~";
const PAGE_DOWN  = "\x1b[6~";
const HOME       = "\x1b[H";
const END        = "\x1b[F";

// Shift-Tab
const SHIFT_TAB  = "\x1b[Z";
```

Existing constants in-repo: see `runs-table.test.tsx` (UP_ARROW, DOWN_ARROW,
PAGE_UP, PAGE_DOWN, ENTER) and `app/mode-transitions.test.tsx` (KEY_RUNS,
ENTER, ESC). Keep these as file-local `const`s rather than pulling into a
shared module — each test reads more like a spec that way.

### Pitfalls with input

- **One write = one keystroke.** Typing `"hi"` fires one `useInput` invocation
  with `input === "hi"`, not two. If the handler expects single characters,
  loop:
  ```ts
  for (const ch of "app") { stdin.write(ch); await flush(); }
  ```
  See `help-overlay.test.tsx` — types `a`, `p`, `p` separately.
- **Modifiers.** There is no way to pass the `key.ctrl`/`meta` flag directly.
  Use the byte: `Ctrl-C` is `\x03`, `Ctrl-A` is `\x01`, …, `Alt-x` is `\x1bx`
  (Esc + char). Ink's `useInput` parses these and sets `key.ctrl`/`key.meta`.
- **Paste vs typing.** Both are the same here: a single `stdin.write("foo")`
  behaves identically to a paste. There is no paste-bracketing in the mock.
- **Ctrl-C.** Because `exitOnCtrlC: false`, `\x03` reaches your `useInput`
  instead of unmounting the app. Handy for testing custom Ctrl-C handlers.

## 3. Async flushing — why `await new Promise(r => setImmediate(r))`

Ink + React combine three async boundaries between "write a key" and "frame is
updated":

1. The `stdin.write` emits `'readable'` synchronously, but Ink's input parser
   reads on the next tick.
2. `useInput` handlers run, dispatch state updates.
3. React schedules a commit; ink's `debug: true` renderer writes the frame
   synchronously on commit — but the commit itself waits a microtask.

One `await new Promise(r => setImmediate(r))` usually covers all three. For
chains (multi-step flows, awaited promises inside effects), pump more:

```ts
async function flush(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>(r => setImmediate(r));
}
```

Used across `approval-modal.test.tsx`, `help-overlay.test.tsx`,
`command-palette-modal.test.tsx`, `log-panel-view.test.tsx`. Default to `n=3`;
bump to `5` when the component awaits user callbacks (`onDecide` resolving,
etc. — see `approval-modal.test.tsx:154`).

Alternatives / complements:

- `await Promise.resolve()` — one microtask. Too weak for `setImmediate`-timed
  work, fine to *combine*.
- `vi.runAllTimersAsync()` — when using fake timers, replaces `setImmediate`
  pumping. See §9.
- Do not use `setTimeout(..., 0)` — longer than `setImmediate`, no benefit.

**Rule of thumb:** if the handler is purely sync, one `flush()` before and
after the write. If it awaits user code or fires nested `setState`s, pump 3–5.

## 4. Working with ANSI

Frames carry ANSI color/style bytes. Strip before asserting textually.

```ts
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
```

Every modal/panel test uses this inline. Keep it file-local — the regex is
short and `strip-ansi` (npm) is CJS-only, awkward with our ESM config.

The regex above handles SGR (color/weight) — the 99% case for Ink output. For
cursor-movement or OSC sequences you need a broader pattern; see
`test/log/ansi.test.ts` for log-pane stripping that handles those.

### Assertion strategies, best → worst

1. **Semantic substring** — `expect(frame).toContain("APPROVAL")`. Robust to
   theme swaps, glyph changes, padding tweaks. Default.
2. **Regex on rendered glyphs** — `expect(frame).toMatch(/\u25c9 approve/)`.
   Good for cursor-indicator style assertions (radio/checkbox). See
   `approval-modal.test.tsx:68-69`.
3. **Ordering** — `indexOf("resume") < indexOf("rerun")` for sort/filter
   tests (`command-palette-modal.test.tsx:109-113`).
4. **Inline snapshot** — avoid. Per `test/README.md`: "Do not add inline ANSI
   snapshots; use `toContain`/`toMatch` on canonicalized strings." ANSI bytes
   churn on every theme change.
5. **`toMatchSnapshot()`** — reserve for the e2e layer, not component tests.

## 5. `useInput` raw-mode & Ink warnings

Ink's `useInput` requires `stdin.isTTY === true` in raw mode; otherwise it
warns "Raw mode is not supported on the current process.stdin". The mock sets
`isTTY = true` and stubs `setRawMode()`, so this is a non-issue — **unless**
you pass a custom `process.stdin` or mount inside `<Static>` / a portal that
reroutes input. Just use `render()` as provided.

If you see the warning during a test, the cause is almost always:

- Rendering a second Ink app inside the first (don't).
- A library that calls `process.stdin.setRawMode()` directly at module load —
  intercept it with `vi.spyOn(process.stdin, "setRawMode").mockImplementation(() => process.stdin)`.

## 6. Testing `@inkjs/ui` components

We use `@inkjs/ui` 2.x. Its components read a theme via context. Our theme
wraps them in a project-local `ThemeProvider` (`src/theme/context.ts`).

**Canonical wrapper pattern** (every modal test uses this):

```tsx
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";

render(
  <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
    <MyComponent {...props} />
  </ThemeProvider>,
);
```

- Pass `color: false` to get deterministic, ANSI-cheap output when asserting
  on glyphs. Use `color: true` only when the test specifically cares about
  color classes.
- `unicode: true` is required for `◉/◯` and box-drawing assertions.
- `@inkjs/ui`'s own `ThemeProvider` is distinct — we do **not** import it;
  `buildTheme()` produces a theme that conforms to both shapes.

For `<TextInput>` or `<Select>` from `@inkjs/ui`: they own their own state and
consume `useInput` internally. Drive them via `stdin.write(...)` exactly as
you would your own components. Watch out — their focus handling means the
input listener only attaches once the component reaches a focused state
(cf. §7).

## 7. Focus, multi-pane composition

Ink's `useFocus` / `<Box>` focus system is active in the mock. Key points:

- A fresh `render()` mounts with no focused element unless a component calls
  `useFocus({ autoFocus: true })` or you wrap with `<FocusManager>`.
- `useInput(..., { isActive })` gates the handler on focus. In tests this
  usually means: **the top-level component's handler runs, nested handlers
  do not**, unless the parent routes focus.
- For sub-components that only act when focused, either:
  - render the sub-component in isolation so it's implicitly active, or
  - wrap with a test harness that force-sets `isActive = true`.

Our modals (`ApprovalModal`, `CommandPaletteModal`, `HelpOverlay`) take an
explicit `isActive`-equivalent or attach input unconditionally — which is why
their tests "just work" without focus plumbing. When you build a component
that gates input, expose a prop for test injection rather than introducing
`<FocusManager>` in the test.

Multi-pane composition: `<AppShell>`, `<ViewingPanes>`, and friends are
tested by supplying explicit `width` and `height` props and asserting on the
composite frame. See `viewing-panes-medium.test.tsx`.

## 8. `rerender`, `unmount`, cleanup

```ts
const { rerender, unmount } = render(<V a={1} />);
await flush();
rerender(<V a={2} />);   // same component, new props — React reconciles
await flush();
unmount();
```

- `rerender` is essential for testing effects that re-subscribe on prop
  changes — canonical example: `log-panel-view.test.tsx:236-283` re-subscribes
  a streaming hook when `selectedStepId` changes.
- Call `unmount()` (or `cleanup()`) in tests that:
  - open streams / timers / intervals that would leak into the next test,
  - assert on teardown side effects (`cancelCount` in `log-panel-view.test.tsx`).
- Most component tests in this repo **don't** call `unmount()` — vitest's
  worker model isolates modules enough that it doesn't matter for pure
  presentational components. Add it when the component uses `useEffect` with
  a cleanup function that matters.
- We do **not** use a global `afterEach(cleanup)` — the library's `cleanup()`
  is a batch unmount of every render in the process, which can interact badly
  with parallel tests. Prefer per-test `unmount()` when needed.

## 9. Vitest patterns

### Fake timers with Ink

Ink schedules renders via microtasks *and* uses `setTimeout` for a few
bounded-time behaviors (e.g., spinner animations in `@inkjs/ui`). When using
fake timers, only fake what you need:

```ts
vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
// NOT setImmediate / queueMicrotask — leaving them real lets React commit.
try {
  // drive the scenario
  await vi.advanceTimersByTimeAsync(99);
  // ...
} finally {
  vi.useRealTimers();
}
```

Canonical example: `log-panel-view.test.tsx:335-395` (live-append latency
test). Note `toFake` explicitly excludes `setImmediate` — otherwise `flush()`
stalls forever.

### Mocks & `vi.fn()`

Standard pattern for asserting key-driven callbacks:

```ts
const onClose = vi.fn();
const { stdin } = render(<Overlay onClose={onClose} />);
await flush();
stdin.write(ESC);
await flush();
expect(onClose).toHaveBeenCalledTimes(1);
```

For async callbacks (`onDecide` returning a Promise), stash the resolver to
test intermediate states ("Deciding…" button) — see
`approval-modal.test.tsx:121-143`.

### Globals disabled

Per `test/README.md`, we run with `globals: false`. Always import `describe`,
`it`, `expect`, `vi` from `"vitest"` explicitly at the top of each test.

### Module resolution

`moduleResolution: "bundler"` + ESM ⇒ import from `src/` with the `.js`
extension (`"../../src/theme/context.js"`), even though the file is `.ts`.

## 10. Snapshot testing — when to use it

**Default: don't.** The 100-column mock stdout + ANSI + glyph variations make
snapshots brittle. Our e2e layer (node-pty + xterm headless, under
`test/e2e/`) has proper snapshot infra with canonicalization.

Use `toMatchInlineSnapshot` in component tests only for **pure pre-computed
layout strings** — keybar fixtures, width-specific row renderings — where the
expected output is the spec. See `keybar-matrix.test.tsx` for the pattern.

Never snapshot raw `lastFrame()` that contains ANSI.

## 11. Common pitfalls

| Symptom | Likely cause |
|---|---|
| `lastFrame()` returns the pre-keypress frame | Missing `await flush()` after `stdin.write`. |
| Handler never runs, no warning | Missing `await flush()` *before* the write — `useInput` listener not attached yet. See `scaffold.test.tsx:24`. |
| "Raw mode is not supported" warning | Something rerouted `process.stdin`; see §5. |
| Test hangs on `advanceTimersByTimeAsync` | You faked `setImmediate`/`queueMicrotask`. Restrict `toFake` (§9). |
| Width assertions fail at `columns=100` | Mock stdout is hard-coded to 100 cols. Pass explicit `width` prop. |
| Duplicate frames or stale output across tests | Prior test leaked a live subscription; add `unmount()` to that test, not a global `cleanup()`. |
| `useInput` fires once then goes silent | Check `isActive` — component gated on focus but not focused in isolated render. |
| Typing `"foo"` doesn't trigger three handler calls | `stdin.write` is one keystroke. Loop characters with a `flush()` between. |
| Theme-dependent snapshot churn | Replace with `toContain` on stripped text, or pin `buildTheme({ color: false })`. |
| Ctrl-C unmounts the app mid-test | `exitOnCtrlC` is already off in the mock — if this happens you're somehow using the real `ink/render`, check imports. |

## 12. Minimal test template

```tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { MyModal } from "../../src/components/my-modal.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const flush = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise<void>(r => setImmediate(r));
};

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

function renderModal(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const r = render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <MyModal width={60} height={16} onClose={onClose} {...overrides} />
    </ThemeProvider>,
  );
  return { ...r, onClose };
}

describe("<MyModal>", () => {
  it("renders its title", () => {
    const { lastFrame } = renderModal();
    expect(stripAnsi(lastFrame() ?? "")).toContain("MY MODAL");
  });

  it("Esc calls onClose", async () => {
    const { stdin, onClose } = renderModal();
    await flush();
    stdin.write(ESC);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

## 13. When to escalate past ink-testing-library

Go to the node-pty e2e harness (`test/e2e/harness.ts`) when you need:

- Real terminal dimensions or resize events (SIGWINCH — see
  `T0010-sigwinch-startup.e2e.test.ts`).
- Alt-screen / bracketed paste / cursor addressing fidelity.
- Multi-process scenarios (child `markflow run` + TUI).
- Actual ANSI compositing (scrollback, clearing).

Component tests are for logic-and-routing-through-the-render; anything that
depends on terminal behavior goes to the higher layer.
