# markflow-tui test harness

Two layers of the [5-layer TUI testing stack](../../../docs/tui/testing.md#6-recommended-stack-for-markflow) live here:

- **Layer 1 — Unit (vitest).** Pure functions with no Ink. Example: `test/reducer.placeholder.test.ts`.
- **Layer 2 — Component (ink-testing-library).** React components rendered through Ink's in-memory stdout. Example: `test/components/scaffold.test.tsx`. Assert on `lastFrame()` output; drive keypresses via `stdin.write(...)`.

Higher layers (3 node-pty, 4 `@microsoft/tui-test`, 5 VHS) arrive in Phase 9 and live elsewhere.

## Commands

Run from the repo root:

    npm test -w packages/markflow-tui             # one-shot run (CI-friendly)
    npm test -w packages/markflow-tui -- --run    # explicit --run flag, equivalent
    npm run test:watch -w packages/markflow-tui   # watch mode during development
    npm run lint -w packages/markflow-tui         # tsc --noEmit, now also checks test/

## Conventions

- Import `describe`, `it`, `expect`, `vi` explicitly from `"vitest"` — globals disabled.
- Use `.js` suffix when importing from `src/` (required by `moduleResolution: "bundler"`).
- Do not add inline ANSI snapshots; use `toContain`/`toMatch` on canonicalized strings.
