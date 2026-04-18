# `@xterm/headless` 6.x Playbook

Practical lookup reference for building and debugging E2E test harnesses that drive
`markflow-tui` with `@xterm/headless` + `node-pty`.

In-repo reference implementation: [`packages/markflow-tui/test/e2e/harness.ts`](../packages/markflow-tui/test/e2e/harness.ts).
Helpers: [`packages/markflow-tui/test/e2e/ansi.ts`](../packages/markflow-tui/test/e2e/ansi.ts).

Installed versions (as of this doc): `@xterm/headless ^6.x`, `node-pty ^1.1.0`.

---

## 1. What `@xterm/headless` actually is

`@xterm/headless` is a stripped-down Node.js build of xterm.js: a full VT
parser + buffer model, with **no DOM, no rendering, no input layer**. You feed
it bytes (raw PTY output); you read characters out of `terminal.buffer.active`.

| In | Out |
|---|---|
| VT500 parser, CSI/OSC/DCS handling, SGR, modes | Canvas/WebGL/DOM renderer |
| `IBuffer` / `IBufferLine` / `IBufferCell` API | `terminal.open(div)`, DOM element, textarea |
| Scrollback, alt buffer, markers | Selection UI, clipboard, link handling |
| Unicode width tables (+ `allowProposedApi` for v11/v15) | Focus, IME, mouse events |
| `write()`, `writeln()`, `resize()`, `dispose()` | `onKey`, `attachCustomKeyEventHandler` |
| Event hooks: `onData`, `onTitleChange`, `onBell`, `onResize`, `onWriteParsed`, `onCursorMove`, `onScroll`, `onLineFeed` | Rendering-dependent events (`onRender` exists but fires only on writes) |

**Use it for:** server-side terminal state tracking, session replay, and E2E
tests that pipe a real child process through a real terminal emulator into a
greppable string buffer.

**Package name history:** `xterm-headless` (pre-5.x) → `@xterm/headless` (5.x+).
If you see `import { Terminal } from 'xterm-headless'` anywhere it is stale —
rewrite to the scoped name.

---

## 2. v5 → v6 breaking changes (what bit us on the bump)

The v6 headless package inherits the v6 core's breaking changes. The ones that
affect Node/headless consumers:

- **`windowsMode` option removed** from `ITerminalOptions`. Replace with
  `windowsPty: { backend, buildNumber }` if you need Windows ConPTY quirks —
  though our harness refuses Windows outright.
- **`fastScrollModifier` option removed** (DOM-only anyway, but errors if set).
- **`ITerminalOptions.overviewRulerWidth` moved** under `ITerminalOptions.overviewRuler`
  (DOM-only).
- **Canvas renderer addon removed** — irrelevant for headless, but if you share
  `ITerminalOptions` with a browser build, drop any `rendererType: 'canvas'`
  leftovers.
- **Alt-arrow → ctrl-arrow implicit mapping removed.** If any test relied on
  pressing `Alt+Arrow` and getting CSI ctrl-arrow bytes out, it must now send
  the ctrl-arrow sequence explicitly.
- **ESM-first packaging.** `package.json` now has a proper `"exports"` field;
  deep imports (`@xterm/headless/lib/...`) are no longer supported. Import
  only from the package root:
  ```ts
  import { Terminal } from "@xterm/headless";
  ```
  In CJS/default-interop contexts (our `harness.ts`) the whole namespace must
  be destructured:
  ```ts
  import xtermHeadless from "@xterm/headless";
  const { Terminal } = xtermHeadless;
  ```
- **Synchronized output (DEC 2026)** is now honoured. Apps that emit
  `CSI ? 2026 h` will buffer writes until `CSI ? 2026 l`. This usually helps
  frame stability, but if a test asserts on a partial frame it can now observe
  a later state than before.

No changes to `write()`, `buffer.active`, `IBufferLine`, or `translateToString`.

---

## 3. Creating a `Terminal`

```ts
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;

const term = new Terminal({
  cols: 120,
  rows: 40,
  scrollback: 0,        // drop history; assert only against viewport
  allowProposedApi: true, // required for some buffer cell APIs + unicode v15
  convertEol: false,    // keep as false; PTY already emits \r\n
});
```

Key options:

| Option | Default | Notes for E2E |
|---|---|---|
| `cols` / `rows` | 80 / 24 | Must match `pty.spawn` dims and any later `resize()`. |
| `scrollback` | 1000 | **Set to `0`** for E2E. Otherwise `buffer.active.length > rows` and `getLine(i)` may not line up with what the user sees. |
| `allowProposedApi` | `false` | Turn **on**. Gates `IBufferCell.getChars()`, `isWide()`, width-variant getters, and some unicode handling. Without it they throw. |
| `convertEol` | `false` | Leave off. PTY already produces CRLF. |
| `cursorBlink`, `theme`, `fontSize`, `rendererType` | n/a | Accepted but meaningless — strip from shared config. |
| `windowsPty` | `undefined` | Only set if you ever run on Windows (we don't). |

---

## 4. Feeding data — `write()` semantics

`write(data, callback?)` is **asynchronous** — the parser batches chunks and
drains on a microtask. The buffer is **not** guaranteed to reflect the write
when `write()` returns.

```ts
term.write(chunk);                         // fire and forget
term.write(chunk, () => { /* parsed */ }); // callback fires after parse
```

Promise-ify if you need to await the drain (e.g. before snapshotting):

```ts
const drain = (t: Terminal) => new Promise<void>((r) => t.write("", r));
await drain(term);
```

`writeln(data, cb?)` = `write(data + "\r\n", cb)`.

Bytes vs strings: both `string` and `Uint8Array` are accepted. `node-pty`
emits strings by default (UTF-8 decoded); pass straight through.

---

## 5. Reading state — `buffer.active`

```ts
const buf = term.buffer.active;   // 'normal' | 'alternate' — Ink uses alternate
buf.cursorX;                      // column (0-indexed)
buf.cursorY;                      // row within viewport (0-indexed)
buf.viewportY;                    // top-of-viewport line index in scrollback
buf.baseY;                        // first line in the "current" region
buf.length;                       // total lines (scrollback + viewport)
buf.type;                         // 'normal' | 'alternate'
```

**Read a line as text:**

```ts
const line = buf.getLine(y);                 // IBufferLine | undefined
const text = line?.translateToString(true);  // trimRight = true
```

`translateToString(trimRight, startColumn?, endColumn?)`:
- `trimRight: true` drops trailing whitespace from the fixed-width cell row.
  **Always pass `true`** for snapshots — otherwise every line is padded to
  `cols` characters.
- Returns printable characters only; **ANSI/SGR is already gone** (the parser
  consumed them into cell attributes).

**Full viewport dump** (our harness's `readScreen`):

```ts
const lines: string[] = [];
for (let y = 0; y < rows; y += 1) {
  const line = buf.getLine(y);
  lines.push(line ? line.translateToString(true) : "");
}
return lines.join("\n");
```

Iterating y from `0` to `rows-1` reads the **viewport** (what the user sees),
not scrollback. With `scrollback: 0` the two coincide. With scrollback > 0 and
an alt-screen app (Ink), `buffer.active.type === 'alternate'` and `y` still
indexes the viewport directly — but keep `scrollback: 0` anyway for sanity.

**Wide characters** (CJK, some emoji): a wide glyph occupies two cells; the
second cell has width 0. `translateToString(true)` handles this correctly.
If you iterate cells manually:

```ts
for (let i = 0; i < line.length; i += 1) {
  const cell = line.getCell(i);
  if (!cell) continue;
  if (cell.getWidth() === 0) continue; // skip the right half of a wide glyph
  process(cell.getChars());            // may be >1 codepoint (ZWJ sequences)
}
```

**Color / SGR stripping:** not needed — the parser turns SGR into per-cell
attributes. `translateToString` emits plain text. If you assert against raw
PTY bytes (e.g. for regression guards on alt-screen toggles), use Node's
built-in:

```ts
import { stripVTControlCharacters } from "node:util"; // 18.17+
```

See [`ansi.ts#stripAnsi`](../packages/markflow-tui/test/e2e/ansi.ts).

---

## 6. Addons that matter for headless

Almost all addons are DOM/renderer-specific. The headless-safe ones:

- **`@xterm/addon-serialize`** — dumps buffer state (incl. SGR) back to a
  string of ANSI bytes for session replay. Handy for reconnection demos; we
  don't use it in tests because `translateToString` is simpler.
- **`@xterm/addon-unicode11` / `@xterm/addon-unicode-graphemes`** — swap in a
  newer Unicode width table. Load before writing CJK/emoji-heavy content:
  ```ts
  import { Unicode11Addon } from "@xterm/addon-unicode11";
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  ```
  Requires `allowProposedApi: true`.
- **`@xterm/addon-search`** — DOM-only; **do not load** in headless (it
  references `terminal.element`). Do your own `indexOf`/regex on the snapshot
  string.

No progress/canvas/webgl/image addons in headless.

---

## 7. Integrating with `node-pty`

The canonical wiring (from `harness.ts`):

```ts
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;

const cols = 120, rows = 40;

const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 });

const child = pty.spawn("node", [binaryPath, ...args], {
  name: "xterm-256color",   // TERM env var for the child
  cols, rows,
  cwd,
  env,                      // inherit + augment; do NOT drop TERM/PATH/HOME
});

child.onData((chunk) => term.write(chunk));
child.onExit(({ exitCode }) => { /* ... */ });
```

**Do not** wire `term.onData(...)` back into `child.write(...)` for tests —
that loop is for interactive forwarding. In an E2E harness the test drives the
child directly via `child.write(keys.ENTER)` etc. See `keys` in
[`ansi.ts`](../packages/markflow-tui/test/e2e/ansi.ts).

**Resize:** resize the PTY *and* the emulator, in that order. They must stay in
sync or the app sees one geometry while the emulator renders against another:

```ts
resize(c, r) {
  child.resize(c, r);   // SIGWINCH to the child
  term.resize(c, r);    // rewraps our buffer
}
```

**Teardown:** kill the child before disposing the terminal. `term.dispose()`
is synchronous and idempotent but frees parser state.

```ts
if (!exited) child.kill();
// wait briefly for exit, then:
term.dispose();
```

**Platform:** `node-pty` on Windows uses ConPTY and behaves differently enough
that our harness throws up front on `process.platform === 'win32'`. Mirror that
in every test with `describe.skipIf(process.platform === 'win32')`.

**Env hygiene:** don't unset `TERM`. Do set app-specific determinism flags
(`MARKFLOW_TEST=1`, `NO_COLOR=1` where relevant, `FORCE_COLOR=0`, pinned
`COLUMNS`/`LINES`) inside `scratch.env`.

---

## 8. E2E testing patterns

### Poll-until-text (don't rely on timers)

Our `waitFor` polls `snapshot()` every 50 ms until a predicate passes or the
deadline expires. Two outs: predicate true, or the child exited non-zero.

```ts
await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);
await session.waitForRegex(/hello\.md\s+\d+ entry/, DEFAULT_WAIT_MS);
```

Budgets in `harness.ts`:
- `DEFAULT_READY_MS = 5_000` — first paint / navigation
- `DEFAULT_WAIT_MS = 15_000` — per-interaction settle
- `DEFAULT_RUN_MS = 30_000` — full workflow execution

Poll interval: **50 ms**. Smaller burns CPU; larger misses fast transitions
(Ink can repaint in <16 ms).

### Anchor to engine state, not pixels

Visual timing is racy. Where possible, assert against the on-disk event log:

```ts
await session.waitForEventLog(runId, /* minSeq */ 3, DEFAULT_RUN_MS);
```

This is the single most effective flake-killer we have. Use it for any
assertion that "the engine did X"; reserve screen assertions for UI concerns.

### Snapshot / canonicalize

Raw screen text contains timestamps, ULIDs, spinner glyphs, tmp paths, and
full-width padding. `canonicalize()` in
[`ansi.ts`](../packages/markflow-tui/test/e2e/ansi.ts) masks all of that to
stable tokens (`<ts>`, `<runid>`, `HH:MM:SS`, `<tmp>`, `<dur>`, …). Always
snapshot via `session.snapshot()`, never `session.screen()`.

### Frame dumping (debug)

Set `E2E_FRAME_DIR=/abs/path` to dump a numbered `.txt` per `waitFor` outcome.
Diff adjacent frames to see exactly which repaint didn't land. Set
`E2E_DEBUG=1` to also mirror raw PTY bytes to the runner's stdout.

### Flush before assert

If you've just pushed a keystroke and want to assert *synchronously* (no
`waitFor`), drain the emulator first:

```ts
child.write(keys.DOWN);
await new Promise<void>((r) => term.write("", r)); // flush parser
// …now snapshot()
```

In practice we always use `waitFor*` and this doesn't come up — prefer the
poll loop.

### Resize races

`resize()` mid-startup is a known Ink trip-hazard (see
[`T0010-sigwinch-startup.e2e.test.ts`](../packages/markflow-tui/test/e2e/T0010-sigwinch-startup.e2e.test.ts)).
Always `await session.waitForText(...)` after a `resize()` before asserting —
the alt-screen clear + repaint isn't instant.

---

## 9. Pitfalls — the short list

1. **Forgetting `trimRight: true`** — every snapshot line pads to `cols`,
   every equality fails.
2. **`scrollback > 0` in tests** — `buffer.active.length` now exceeds `rows`
   and naive `for (y < rows)` loops drift out of sync with what the user sees
   once the screen scrolls. Keep it at `0`.
3. **Asserting before parse drains** — `write()` is async. Use `waitFor*` or a
   `write("", cb)` flush.
4. **Not resizing both ends** — PTY and emulator must be resized together and
   in the same order. Otherwise Ink renders against the old size.
5. **Deep-importing `@xterm/headless/lib/...`** — broken in v6's exports map.
   Use the package root only.
6. **Loading DOM addons** — `addon-search`, `addon-web-links`,
   `addon-canvas`, `addon-webgl` will throw/noop in headless. Only
   `addon-serialize` and the `unicode*` addons are safe.
7. **Treating `onRender` as "something changed"** — in headless it fires on
   writes, not on any "frame commit". Use `onWriteParsed` or just poll.
8. **Leaking terminals** — every `new Terminal()` must be `dispose()`d after
   `child.kill()`. Vitest parallelism will accumulate parser state otherwise.
9. **`CSI ? 2026` buffering (v6-new)** — apps using synchronized output will
   appear to "jump" rather than paint progressively. This is correct; adjust
   asserted intermediate states.
10. **Spinner / timestamp drift** — canonicalize before snapshotting; see the
    `MASKS` table in `ansi.ts`.
11. **Wide-char off-by-one in manual cell iteration** — skip cells with
    `getWidth() === 0`; `translateToString` already does this.
12. **Mixing `term.onData` into tests** — that hook is for user-typed input in
    an interactive app. In tests you write to the PTY directly; leave
    `term.onData` unbound.

---

## 10. One-screen cheat sheet

```ts
// setup
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;

const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 });
const child = pty.spawn("node", [bin, ...args], { name: "xterm-256color", cols, rows, cwd, env });
child.onData((c) => term.write(c));

// drive
child.write("\r");              // Enter
child.write("\x1b[B");          // Down
child.write("\x03");             // Ctrl-C

// read
const buf = term.buffer.active;
const screen = Array.from({ length: rows }, (_, y) =>
  buf.getLine(y)?.translateToString(true) ?? "",
).join("\n");

// resize
child.resize(c, r); term.resize(c, r);

// teardown
child.kill(); term.dispose();
```

---

## 11. References

- Source: [`packages/markflow-tui/test/e2e/harness.ts`](../packages/markflow-tui/test/e2e/harness.ts)
- Source: [`packages/markflow-tui/test/e2e/ansi.ts`](../packages/markflow-tui/test/e2e/ansi.ts)
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js)
- [xterm.js Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)
- [`@xterm/headless` on npm](https://www.npmjs.com/package/@xterm/headless)
- [`node-pty` on npm](https://www.npmjs.com/package/node-pty)
- xterm.js 6.0 release notes: https://github.com/xtermjs/xterm.js/releases
