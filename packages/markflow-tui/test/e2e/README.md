# markflow-tui E2E harness (Layer 3)

Layer-3 of the TUI testing stack (see `docs/tui/testing.md` §6): spawns the
built `dist/cli.js` binary inside a [`node-pty`](https://github.com/microsoft/node-pty)
pseudo-terminal and mirrors output through [`@xterm/headless`](https://www.npmjs.com/package/@xterm/headless)
so journey tests can assert on the rendered screen, the on-disk registry, or
the engine run directory.

## Running

```bash
# From the repo root:
npm run test:e2e -w packages/markflow-tui
# watch mode (expects a separate `npm run build -w packages/markflow-tui` in another shell):
npm run test:e2e:watch -w packages/markflow-tui
```

The script always rebuilds the TUI before invoking vitest — stale `dist/` is
one of the easier ways to introduce a flake.

## Layout

```
test/e2e/
├── harness.ts             spawnTui() → TuiSession
├── ansi.ts                stripAnsi, canonicalize, keys
├── tmp.ts                 createScratchEnv() — per-test temp HOME/registry/runs/workspace
├── fixtures/              self-contained .md workflows
│   ├── hello.md
│   ├── flaky.md
│   └── approve.md
├── journey-add-run.e2e.test.ts
├── journey-rerun.e2e.test.ts
└── journey-approval.e2e.test.ts
```

## Debugging knobs

Two env-flags on the harness for watching tests run and inspecting failures:

- **`E2E_DEBUG=1`** — mirrors the raw PTY byte stream to the test runner's
  stdout so you can *watch the TUI repaint live* while vitest drives it. Run
  a single test for best results:

  ```bash
  E2E_DEBUG=1 npx vitest run packages/markflow-tui/test/e2e/journey-add-run.e2e.test.ts
  ```

- **`E2E_FRAME_DIR=/abs/path`** — dumps a canonicalised frame to that
  directory after every `waitFor()` settles, times out, or observes a bad
  exit. Frames are numbered `NNNN-<label>.txt` (`ok` / `timeout` / `exit`)
  so you can `cat frames/*.txt` or `diff frames/0003-ok.txt frames/0004-ok.txt`
  to see exactly what the test asserted on.

  ```bash
  E2E_FRAME_DIR=/tmp/markflow-frames npx vitest run \
    packages/markflow-tui/test/e2e/journey-approval.e2e.test.ts
  ```

Both can be combined. Neither is wired to CI — they're local-only.

## Flake budget: zero

- No hard-coded `sleep()` outside the polling loop inside `waitFor`.
- Every wait has an explicit ms timeout.
- Every `HarnessTimeoutError` carries the final canonicalised frame for
  post-mortem.

## Platform support

- macOS + Linux only. Windows journeys early-return via
  `test.skipIf(process.platform === "win32")` — ConPTY behaviour differs enough
  that we maintain a single-platform golden for now. See
  `docs/tui/plans/P9-T1.md` §6 D6/D7.
