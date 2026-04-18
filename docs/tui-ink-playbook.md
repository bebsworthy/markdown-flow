# Ink 7 Playbook

Practical reference for writing Ink 7.x components in `packages/markflow-tui`. Assumes React fluency; tells you what Ink 7 expects rather than how to learn React.

**Stack baseline.** Ink 7 requires **Node.js 22+** and **React 19.2+** (it uses `useEffectEvent` internally to stabilize input handlers). Mixing older React versions in the same tree will break.

Primary sources cited inline:
- [README](https://github.com/vadimdemedes/ink/blob/master/readme.md)
- [Release v7.0.0](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0)
- [Releases index](https://github.com/vadimdemedes/ink/releases)
- Context7 llms snapshot at `context7.com/vadimdemedes/ink/llms.txt`

## What changed: 5 → 6 → 7

### Ink 7.0.0 (breaking) — [release notes](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0)

- **Node 22+, React 19.2+** required. Anything older silently misbehaves or throws at mount.
- **Backspace fix.** Backspace now sets `key.backspace`, not `key.delete`. If you had `if (key.delete)` treating it as "erase previous char", switch to `if (key.backspace)`. The Delete key finally reports `key.delete`.
- **Escape fix.** Plain `Esc` no longer sets `key.meta: true`; only `key.escape: true`. Any `key.meta && !key.escape` guard that relied on the old quirk will no longer match bare Escape.
- **Input handlers are stable across renders.** Ink wraps your `useInput` callback in `useEffectEvent`, so it no longer re-subscribes on every render. A stale-closure bug in Ink 5/6 where an input handler captured old state on fast typing is gone — but if your code depended on the resubscription cycle (unlikely), review it.

### New in Ink 7

- Hooks: `usePaste`, `useWindowSize`, `useBoxMetrics`, `useAnimation`, `useCursor`, `useIsScreenReaderEnabled`.
- `render()` options: `alternateScreen`, `interactive` (force override of CI/TTY detection).
- `<Box>` props: `maxWidth`, `maxHeight`, `aspectRatio`, `alignContent`, `position="static"`, directional `top/right/bottom/left`, `borderBackgroundColor` (+ per-side variants).
- `<Text wrap="hard">` pads lines to full column width (useful for striped/banded backgrounds).
- `useFocusManager()` gained `activeId`.
- CJK and wide-char truncation bugs fixed; `useInput` no longer crashes on unmapped keycodes.

### Ink 6 highlights (already on 7, but worth knowing)

- `renderToString()` for synchronous string output, no terminal needed (6.8).
- Opt-in React **concurrent mode** + Suspense via `render(tree, { concurrent: true })` (6.7).
- Opt-in **Kitty keyboard protocol** with `render(tree, { kittyKeyboard: { mode: 'auto', flags: [...] } })` (6.7) — gives you `key.eventType` (`'press' | 'repeat' | 'release'`), modifier-safe disambiguation (Ctrl+I vs Tab, Shift+Enter vs Enter), and extra modifiers (`super`, `hyper`, `capsLock`, `numLock`).
- `incrementalRendering` option reduces full-frame redraws (6.5), and synchronized update sequences landed in 6.7 to reduce tearing on supporting terminals.
- `home` / `end` keys in `useInput` (6.6).

---

## Core API

### `render(tree, options)`

```tsx
const instance = render(<App />, {
  stdout: process.stdout,          // default
  stdin: process.stdin,            // default
  stderr: process.stderr,          // default
  exitOnCtrlC: true,               // default — Ink exits the process on ^C
  patchConsole: true,              // default — console.* is captured and re-emitted above the live frame
  debug: false,                    // set true to dump each frame as its own block (no cursor movement)
  maxFps: 30,                      // frame rate cap
  incrementalRendering: false,     // only rewrite changed lines — try before disabling for flicker
  concurrent: false,               // React 19 concurrent + Suspense
  interactive: true,               // auto-detected; force when piping or testing
  alternateScreen: false,          // vim/less-style: restore previous buffer on exit
  kittyKeyboard: { mode: 'auto', flags: ['disambiguateEscapeCodes'] },
  onRender: ({ renderTime }) => {},
});

instance.rerender(<App updated />);
await instance.waitUntilExit();
instance.unmount();
instance.clear();
await instance.waitUntilRenderFlush(); // resolves after stdout flush
instance.cleanup(); // unmount + drop internal instance; required before re-render()ing to same stdout
```

Source: [README § API](https://github.com/vadimdemedes/ink/blob/master/readme.md).

**`alternateScreen: true`** switches the terminal to the alternate buffer (like Vim). Only effective when `interactive` is true and a real TTY is attached; ignored in CI or when stdout is piped. Good fit for a full-screen TUI like `markflow-tui` because the user's scrollback is preserved on exit.

**`patchConsole: true` (default).** Any `console.log` during render is buffered and printed above the live frame. If a library logs during render or in effects, Ink keeps your UI intact. Disable if you are writing your own output loop.

### `renderToString(tree, { columns? })`

Synchronous. Runs `useLayoutEffect` synchronously, runs `useEffect` but ignores its output. Terminal hooks are no-ops (don't throw). Use for snapshots/docs, not live UI.

### `<Box>` — flexbox in the terminal via Yoga

`<Box>` is `display: flex` by default. All layout props (complete list):

| Group | Props |
|---|---|
| Dimensions | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `aspectRatio` |
| Padding | `padding`, `paddingX`, `paddingY`, `paddingTop/Right/Bottom/Left` |
| Margin | `margin`, `marginX`, `marginY`, `marginTop/Right/Bottom/Left` |
| Gap | `gap`, `columnGap`, `rowGap` |
| Flex | `flexGrow` (default 0), `flexShrink` (default 1), `flexBasis`, `flexDirection` (`row`/`row-reverse`/`column`/`column-reverse`), `flexWrap` |
| Alignment | `alignItems`, `alignSelf`, `alignContent`, `justifyContent` |
| Position | `position` (`relative`/`absolute`/`static`), `top`, `right`, `bottom`, `left` |
| Overflow | `overflow`, `overflowX`, `overflowY` (`visible`/`hidden`) |
| Display | `display` (`flex`/`none`) |
| Border | `borderStyle`, `borderColor`, side-specific `border{Side}Color`, `borderDimColor`, side `border{Side}DimColor`, `borderBackgroundColor`, side `border{Side}BackgroundColor`, per-side visibility `borderTop/Right/Bottom/Left` booleans |
| Background | `backgroundColor` |

Border styles: `'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic'` or a custom `BoxStyle` object.

```tsx
<Box flexDirection="column" padding={1} gap={1}>
  <Box borderStyle="round" flexGrow={1} justifyContent="center" alignItems="center">
    <Text>Center pane</Text>
  </Box>
  <Box width={30}><Text>fixed column</Text></Box>
</Box>
```

### `<Text>`

Accepts **text nodes and nested `<Text>` only**. A `<Box>` inside `<Text>` throws. All styling of characters happens here, not on `<Box>`.

Props: `color`, `backgroundColor`, `dimColor`, `bold`, `italic`, `underline`, `strikethrough`, `inverse`, and `wrap`:
- `'wrap'` (default) — soft wrap on spaces
- `'hard'` — new in 7; pads every line to the container's column width, useful for striped backgrounds and full-width highlights
- `'truncate'` / `'truncate-end'` — cut at end
- `'truncate-start'` — cut at start
- `'truncate-middle'` — cut in middle with ellipsis

### `<Newline count={n} />`, `<Spacer />`

`<Newline>` inserts `n` newlines inside `<Text>`. `<Spacer>` flex-fills the parent Box along its `flexDirection`, pushing siblings apart (`<Left /> <Spacer /> <Right />`).

### `<Static items={arr}>{(item, i) => <Row key/>}</Static>`

Writes each item **once**, above the live frame. Changes to previously emitted items are ignored — `<Static>` only renders new items appended to `items`. Ideal for completed log lines, finished task rows, test results. The root of each child **must** carry a stable `key`.

```tsx
<Static items={completedTasks}>
  {(task) => (
    <Box key={task.id}>
      <Text color="green">✓ </Text><Text>{task.name}</Text>
    </Box>
  )}
</Static>
```

### `<Transform transform={(line, index) => string}>`

Mutates the string form of child output per line. Children **must** be `<Text>`. Beware: if the child emits ANSI escapes (colors), the `line` string contains them; use `strip-ansi` / `slice-ansi` for correct width accounting.

```tsx
<Transform transform={(line, i) => (i === 0 ? line : '    ' + line)}>
  <Text>…long wrapping paragraph…</Text>
</Transform>
```

---

## Hooks

### `useInput(handler, { isActive? })`

Fires per keystroke. If the user **pastes** (more than one char arrives in a tick), the entire string arrives as `input` in one call — unless you also use `usePaste`, in which case paste is diverted off this channel.

```tsx
useInput((input, key) => {
  if (input === 'q') exit();
  if (key.leftArrow) cursorLeft();
  if (key.ctrl && input === 'c') {/* ^C — only if exitOnCtrlC: false */}
}, { isActive: !modalOpen });
```

`key` fields: `leftArrow`, `rightArrow`, `upArrow`, `downArrow`, `return`, `escape`, `tab`, `ctrl`, `shift`, `meta`, `super`, `hyper` (kitty), `capsLock`/`numLock` (kitty), `backspace`, `delete`, `pageUp`, `pageDown`, `home`, `end`, `eventType` (`'press'|'repeat'|'release'`, kitty only).

**Ink 7 callback stability.** Ink wraps the handler with `useEffectEvent`, so you don't need to memoize. Reading state inside the handler sees the latest render's value. This is the biggest practical change for existing code — you can remove `useCallback` wrappers used only to calm Ink 5.

**Disabling.** Pass `{ isActive: false }` when a sibling modal owns the keyboard. Simpler than unmounting or conditionally rendering.

### `usePaste(handler, { isActive? })`

New in 7. Enables bracketed paste mode (`\x1b[?2004h`) while mounted. Receives the full pasted string in one call; preserves embedded newlines/escapes. Runs on a separate channel from `useInput`, so typed keys continue to reach `useInput` while paste content does not.

### `useApp()`

`{ exit(errOrResult?), waitUntilRenderFlush() }`. `exit()` → resolve; `exit(Error)` → reject `waitUntilExit()`; `exit(value)` → resolve with value (added 6.8).

### `useStdin()`

`{ stdin, isRawModeSupported, setRawMode(enabled) }`. **Always use Ink's `setRawMode`**, not Node's — Ink's wraps the toggle so `^C` handling stays correct.

### `useStdout()` / `useStderr()`

`{ stdout, write(data) }` / `{ stderr, write(data) }`. `write()` emits above the live frame safely. Don't write directly to `process.stdout` in an Ink app unless you also disable `patchConsole` — you will get interleaving.

### `useFocus({ autoFocus?, isActive?, id? })`

Returns `{ isFocused }`. Focus order follows render order. Set `autoFocus` on the first pane you want focused. `id` is optional but required for `focusManager.focus(id)` and for the new `activeId`.

### `useFocusManager()`

```ts
const {
  enableFocus, disableFocus,
  focusNext, focusPrevious, focus,
  activeId,                  // new in 7
} = useFocusManager();
```

Default Tab/Shift-Tab binding is built-in. Call `disableFocus()` while a modal captures input, then `enableFocus()` after close. Use `focus(id)` to jump programmatically.

### `useWindowSize()` (new in 7)

`{ columns, rows }`. Re-renders on SIGWINCH. Prefer this over reading `process.stdout.columns` yourself.

### `useBoxMetrics(ref)` (new in 7)

Preferred over the older `measureElement(ref.current)`. Returns `{ width, height, left, top, hasMeasured }` and re-renders when the measured box changes size. Still zero on the first pass — gate on `hasMeasured` when rendering dependent UI.

```tsx
const ref = useRef(null);
const { width, hasMeasured } = useBoxMetrics(ref);
<Box ref={ref} flexGrow={1}>
  <Text>{hasMeasured ? `w=${width}` : '…'}</Text>
</Box>
```

`measureElement(ref.current)` from `'ink'` still works but requires you to run it inside an effect and manage your own resize listener — don't use it in new code.

### `useAnimation({ interval?, isActive? })` (new in 7)

`{ frame, time, delta, reset() }`. `frame` is an integer counter (use `frame % spinner.length`). `time` is ms elapsed. `delta` is ms since previous tick. Pausing via `isActive: false` is cheaper than unmounting.

### `useCursor()`

`{ setCursorPosition({x, y} | undefined) }`. Used for IME/editing widgets. Pass `undefined` to hide. Use `string-width` to compute `x` with wide chars/emoji.

### `useIsScreenReaderEnabled()`

Returns boolean. Honors `INK_SCREEN_READER` env var and the `isScreenReaderEnabled` render option. Gate decorative glyphs and spinner animation when true.

---

## Layout (Yoga) — pitfalls

- **Every `<Box>` is flex by default.** No `display: block`. Stack vertically with `flexDirection="column"`.
- **`flexShrink: 1` is the default.** In a horizontal row, a long `<Text>` will shrink its sibling. If you want a fixed sidebar, set `flexShrink={0}` on it.
- **Width percentages** resolve relative to the parent's content box. A `width="100%"` child of a bordered/padded parent won't overflow.
- **`flexGrow` needs a bounded parent.** A row inside an unconstrained `<Box>` won't stretch; put it inside a parent with explicit `width` or a `flexGrow` chain that reaches `<App>`.
- **Don't nest `<Box>` inside `<Text>`.** Throws. Style text with `<Text color>`, not the parent `<Box>`.
- **`backgroundColor` on `<Box>` fills only the Box's rect,** and is inherited by child `<Text>` only if the child doesn't set its own. If you want a fully painted row including padding, use `<Text wrap="hard" backgroundColor="…">` inside a Box with matching width.
- **`overflow: hidden`** clips, but does not provide scrollback. Virtualize long lists yourself (slice the array before rendering).
- **CI detection.** When `process.env.CI` is truthy or stdout is not a TTY, Ink renders only the final frame and ignores resizes. Force with `{ interactive: true }` (Ink 7) or `CI=false`.
- **Re-mounting vs. `cleanup()`.** Calling `render()` twice on the same stdout without `cleanup()` on the previous instance leaks listeners — particularly visible in tests.

---

## Input handling patterns

### Raw mode

```tsx
const { isRawModeSupported, setRawMode } = useStdin();
useEffect(() => {
  if (!isRawModeSupported) return;
  setRawMode(true);
  return () => setRawMode(false);
}, [isRawModeSupported]);
```

`useInput` enables raw mode for you — you only need this when reading from stdin directly.

### Modal keyboard capture

```tsx
const focusMgr = useFocusManager();
useEffect(() => {
  if (!open) return;
  focusMgr.disableFocus();
  return () => focusMgr.enableFocus();
}, [open]);

// Background screen's useInput
useInput(handleGlobal, { isActive: !open });

// Modal's useInput
useInput(handleModal, { isActive: open });
```

### Chord keys (gg, etc.)

Keep a small state machine. Ink 7's stable handler means you can read state inside:

```tsx
const [pending, setPending] = useState('');
useInput((input) => {
  if (pending === 'g' && input === 'g') { jumpTop(); setPending(''); return; }
  if (input === 'g') { setPending('g'); return; }
  setPending('');
});
```

Consider a timeout to clear `pending` so a lone `g` doesn't stick.

### Distinguishing Tab from Ctrl+I, etc.

Both encode to the same byte in legacy terminals. Enable Kitty:

```tsx
render(<App />, {
  kittyKeyboard: { mode: 'auto', flags: ['disambiguateEscapeCodes'] },
});
```

Then `key.tab` only fires for Tab, and `key.ctrl && input === 'i'` only for Ctrl-I. Same for Shift+Enter vs Enter, Escape vs Ctrl+[.

---

## Focus and multi-pane composition

1. Decide the pane order in JSX — that is the Tab order.
2. `autoFocus` on exactly one pane at mount.
3. Each focusable leaf calls `useFocus({ id })` and styles on `isFocused`.
4. The app shell listens for navigation keys and calls `focusManager.focus('runs' | 'steps' | 'preview')` to jump panes without Tab.
5. Read `activeId` when you need to branch global keybindings by pane.

```tsx
const Pane = ({ id, children }: { id: string; children: ReactNode }) => {
  const { isFocused } = useFocus({ id });
  return (
    <Box borderStyle="round" borderColor={isFocused ? 'cyan' : 'gray'} flexGrow={1}>
      {children}
    </Box>
  );
};

const Shell = () => {
  const { activeId, focus } = useFocusManager();
  useInput((input) => {
    if (input === '1') focus('runs');
    if (input === '2') focus('steps');
  });
  return (
    <Box flexDirection="row" gap={1}>
      <Pane id="runs">…</Pane>
      <Pane id="steps">…</Pane>
    </Box>
  );
};
```

---

## Performance

- **Cap output with `<Static>`.** Every live re-render repaints the entire dynamic region. Move finished log lines into `<Static items={logs}>` so they render once and stop costing.
- **Virtualize tables.** Slice your data array to the visible window before `.map()`. Ink doesn't clip children for you — offscreen rows are still laid out.
- **`incrementalRendering: true`** trades a little CPU for much less flicker and bandwidth on SSH links.
- **`maxFps`** gates the paint loop. Default 30 is fine; go lower (10–15) for CI-like or bandwidth-constrained terminals.
- **`onRender({ renderTime })`** is the simplest profiler. Log to a file in dev; a 5ms paint becoming 30ms is usually a missing memo on a big map.
- **Memoize expensive derivation, not components.** Ink components are tiny; the cost is in your derive/sort/filter code. Keep it out of render — this is already the pattern in `markflow-tui/src/runs/` and `steps/`.
- **Avoid `useBoxMetrics` for layout decisions during render.** It causes a second render when measurement arrives. Use it for reporting sizes, not for computing child tree shape.
- **Don't re-create handlers every render.** With Ink 7's stable `useInput`, you no longer need `useCallback` around the handler, but avoid capturing big objects if the callback closes over state you don't need.

---

## Testing

Use `ink-testing-library` — a sibling package. Its `render()` returns `{ lastFrame, frames, rerender, unmount, stdin }`. Don't use Ink's own `render()` in tests; it writes to the real TTY. The testing strategy lives in `docs/tui/testing.md`. (Another agent owns that page — this playbook does not duplicate it.)

One cross-cutting note: `ink-testing-library` historically lagged Ink majors. Verify its peer ranges match Ink 7 / React 19.2 before assuming a test failure is your bug.

---

## React 19 interaction

- **`useEffectEvent` is fine.** Ink uses it; your code can too. Handlers declared with `useEffectEvent` don't count as effect deps.
- **`use()` and Suspense work only with `concurrent: true`.** Without it, throwing a promise reaches Ink's commit phase and crashes. Turn concurrent mode on at the app root if you use Suspense anywhere.
- **Ref as prop.** React 19 removed `forwardRef` as a requirement. Ink 7 Box/Text accept `ref` directly; you don't need `forwardRef` wrappers.
- **Actions / `useTransition` / `useOptimistic`** run, but their observable benefit on a terminal is mostly deferred renders at 30fps — rarely worth the complexity for CLI UI.
- **StrictMode double-invocation** of effects (dev only) can double-subscribe to stdin listeners if you manage them manually. Always clean up in effect returns and prefer `useInput` over manual `stdin.on('data', …)`.
- **`act()` warnings.** React 19 tightened `act` semantics. When you see them in tests, wrap the triggering input in `act(async () => { stdin.write('x'); await flush(); })`.

Source: [Ink v7 release notes](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0), [React 19 release](https://react.dev/blog/2024/12/05/react-19).

---

## Known gotchas

1. **Backspace vs Delete (Ink 7).** `key.backspace` is what typing Backspace emits. `key.delete` is the forward-delete key. Migration from Ink 5/6 requires auditing every `key.delete` usage.
2. **Escape no longer sets `key.meta`.** Don't gate Escape behavior on `key.meta`.
3. **`<Text>` only accepts text / `<Text>`.** A `<Box>` or a number-without-Text child will throw. React fragments of `<Text>` are fine.
4. **`<Static>` is append-only.** Editing an emitted item does nothing. For a tail-like view, add new items; don't mutate.
5. **Keys on `<Static>` children are required**, at the topmost rendered element returned from the render function.
6. **`measureElement` returns zeros during render.** Only meaningful inside effects. Use `useBoxMetrics` instead for reactive measurement.
7. **Transform + ANSI.** Child color/bold become ANSI escapes in the `line` string passed to `transform`. Use `strip-ansi`/`slice-ansi` when doing width math.
8. **Concurrent mode and multiple `render()`.** Mounting twice into the same stdout without `cleanup()` is unsupported in concurrent mode and flaky in legacy mode.
9. **Raw mode requires a TTY.** `isRawModeSupported` is false when piped — `useInput` then silently does nothing. Force-enable input paths in tests with `ink-testing-library`'s injected stdin.
10. **`patchConsole` interleaving.** If you `console.log` after calling `instance.unmount()`, output may land in odd places. Call `await instance.waitUntilExit()` first.
11. **CI auto-detection.** Ink stops animating under CI. If you record VHS tapes in a non-TTY wrapper, pass `{ interactive: true }`.
12. **Alternate screen + debug.** `alternateScreen: true` with `debug: true` is nonsensical — debug mode prints each frame as a separate block, which defeats alternate-screen restoration. Pick one.
13. **`flexShrink` defaults to 1.** Fixed-width sidebars need `flexShrink={0}` or they collapse under a long row.
14. **Wide characters / emoji.** Widths come from `string-width`. A `width={10}` box holds ~5 emoji, not 10. Test CJK rendering explicitly — CJK truncation was fixed in 7 but your own width math might still be wrong.
15. **Don't mix Ink and non-Ink writes.** Anything that writes to stdout outside Ink (child process inherit, `process.stdout.write`, third-party progress bar) will corrupt the frame. Redirect child output or use `useStdout().write()`.
