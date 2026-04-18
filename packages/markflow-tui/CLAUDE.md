# markflow-tui

Ink 7 + React 19 terminal UI for browsing workflows and visualizing runs.

## Commands

```bash
npm run build -w packages/markflow-tui
npm run test  -w packages/markflow-tui
npm run lint  -w packages/markflow-tui
npm run dev   -w packages/markflow-tui   # tsx watch with hot reload
```

Single test file:

```bash
npx vitest run packages/markflow-tui/test/runs/derive.test.ts
```

## Architecture

React + Ink app. Pure logic lives outside components and is unit-tested in isolation.

| Directory | What |
|---|---|
| `src/primitives/` | Yoga-first building blocks: DataTable, SplitPane, Panel, Modal, TextInput |
| `src/theme/` | Color tokens, glyphs, frame chars, capabilities detection. `context.tsx` provides `useTheme()` |
| `src/components/` | Ink components — app shell, tables, modals, keybar |
| `src/state/` | Top-level app reducer + types |
| `src/engine/` | Adapter subscribing to markflow engine events |
| `src/runs/` | Runs table: derive, sort, filter, columns, cursor (pure) |
| `src/steps/` | Step table: derive, tree, aggregate, columns (pure) |
| `src/browser/` | Workflow browser: list/preview layout (pure) |
| `src/registry/` | On-disk registry for known workflows/runs |

## Key Constraints

- **No React.memo on components that call useInput.** React 19.2 + `useEffectEvent` bug causes stale closures in `SimpleMemoComponent` fibers. Memo is fine for passive/display-only components.
- **Never pass `display={undefined}` to Ink Box.** Use conditional spread: `{...(visible ? {} : { display: "none" as const })}`.
- **Pure module discipline.** Modules in `runs/`, `steps/`, `state/`, `engine/`, `theme/` (except `context.tsx`) must not import `ink`, `react`, `node:fs`, or `node:child_process`. Enforced by `test/state/purity.test.ts`.
- **DataTable owns windowing and headers.** Don't subtract header rows from its height externally. Subtract only non-table chrome (filter bars, footers).

## Playbook

See `docs/tui/playbook-ink-yoga.md` for the full component framework guide: primitives API, theme system, patterns for adding new views, and testing approach.
