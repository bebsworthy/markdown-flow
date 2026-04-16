# markflow-tui VHS scaffold

Layer 5 of the [5-layer TUI testing stack](../../../docs/tui/testing.md#6-recommended-stack-for-markflow) — visual regression via [charmbracelet/vhs](https://github.com/charmbracelet/vhs). Scaffold only at this phase; real golden tapes arrive in Phase 9.

## Install VHS locally

    brew install vhs            # macOS
    # or:
    go install github.com/charmbracelet/vhs@latest

VHS also needs `ttyd` and `ffmpeg` — `brew install ttyd ffmpeg` on macOS, or the equivalents on Linux. See the [VHS install guide](https://github.com/charmbracelet/vhs#installation) for the full list.

Verify:

    vhs --help

## Record the scaffold

From this directory (`packages/markflow-tui/vhs/`):

    # 1. Build the TUI binary first — the tape runs `node ../dist/cli.js`.
    npm run build -w packages/markflow-tui

    # 2. Render the tape.
    vhs scaffold.tape

Output lands at `out/scaffold.gif` (git-ignored).

## CI status

VHS is **not run in CI yet**. It will be gated behind a `workflow_dispatch` trigger in a dedicated `.github/workflows/vhs.yml` when Phase 9 lands (see `docs/tui/plan.md` Phase 9 and `docs/tui/testing.md` §Layer 5). Until then, the tape exists purely as a local tool.

## Files

- `scaffold.tape` — records the empty Ink app (renders "markflow-tui · scaffold", then `q` to quit).
- `out/` — generated GIFs (git-ignored).
