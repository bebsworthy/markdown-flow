# Ink + Yoga Component Playbook

How to build TUI components in this codebase. Read this before writing new views.

## Architecture at a Glance

```
ThemeProvider (context.tsx)
  └─ AppShell (frame chrome, mode tabs)
       ├─ SplitPane / Panel (layout)
       │    ├─ DataTable<T> (tabular data with cursor + windowing)
       │    ├─ ScrollView<T> (list with virtual scroll)
       │    └─ Cell (fixed-width text cell)
       ├─ Modal (overlay dialog)
       └─ TextInput (single-line input field)
```

All primitives live in `src/primitives/`. All theme types live in `src/theme/`.

---

## Primitives Reference

### DataTable\<T\>

The primary way to render tabular data. Handles column layout, cursor highlighting, virtual scrolling, header rendering, and empty state — you provide the data and column definitions.

```tsx
import { DataTable, type ColumnDef } from "../primitives/DataTable.js";

const columns: ColumnDef<MyRow>[] = [
  { id: "name",   header: "NAME",   width: 20, render: (r) => r.name },
  { id: "status", header: "STATUS", width: 12, render: (r) => r.statusLabel,
    renderCell: (r, w) => <Text color={r.color}>{r.glyph} {r.statusLabel}</Text> },
  { id: "note",   header: "NOTE",   grow: true, render: (r) => r.note },
];

<DataTable<MyRow>
  columns={columns}
  rows={sortedRows}
  rowKey={(r) => r.id}
  cursorIndex={cursor}
  width={paneWidth}
  height={availableHeight}
  cursorGlyph="▶"
  emptyState={<Text dimColor>no data yet</Text>}
/>
```

**Key details:**

- `render(row) → string` is the text representation (used for plain text cells).
- `renderCell(row, width) → ReactNode` overrides the entire cell when you need color, glyphs, or inline components. Always set `wrap="truncate-end"` on the returned `<Text>`.
- Exactly one column should have `grow: true` — it fills remaining width (typically the rightmost column).
- `height` is the total height including the header row. The table renders `height - 1` data rows.
- Windowing is automatic — DataTable tracks scroll offset internally via `computeWindow`.
- `cursorGlyph` (default `"›"`) appears in a gutter column to the left of the cursor row.

### SplitPane

Two-child layout with ratio-based sizing and optional divider.

```tsx
import { SplitPane } from "../primitives/SplitPane.js";

<SplitPane direction="row" ratio={0.55} divider
           width={80} height={24}
           minFirst={20} minSecond={20}>
  <LeftPanel width={leftWidth} />
  <RightPanel width={rightWidth} />
</SplitPane>
```

**Key details:**

- `children` must be a tuple of exactly two elements.
- `ratio` (0–1) sets `flexBasis` percentages. Both children have `flexGrow={1}`.
- When `divider={true}`, a 1-cell border line renders between children (gap is forced to 0). The border style auto-resolves from the theme (double/classic).
- `minFirst` / `minSecond` set minimum column or row sizes per pane.
- Children often still need explicit `width` props for internal text truncation — SplitPane controls Yoga layout but children may compute text budgets independently.

### Panel

Bordered container. Used for framed content regions.

```tsx
import { Panel } from "../primitives/Panel.js";

<Panel title="Details" width={40} height={10}>
  {content}
</Panel>
```

**Key details:**

- Border style auto-resolves from theme (`"double"` when unicode, `"classic"` otherwise).
- `title` renders bold inside the top border area.
- `display` prop accepts `"flex"` or `"none"` — see the conditional display rule below.

### Modal

Overlay dialog that renders on top of existing content.

```tsx
import { Modal } from "../primitives/Modal.js";

<Modal visible={isOpen} title="Add Workflow" onClose={() => setOpen(false)}>
  {formContent}
</Modal>
```

**Key details:**

- Returns `null` when `visible === false` — no DOM footprint.
- Listens for Escape key internally when `onClose` is set.
- Wraps content in a `Panel` with `position="absolute"` centering.
- Defaults: maxWidth=90, minWidth=30, minHeight=5.

### TextInput

Single-line text input with cursor, placeholder, and prompt.

```tsx
import { TextInput } from "../primitives/TextInput.js";

<TextInput
  value={query}
  onChange={setQuery}
  onSubmit={handleSubmit}
  onCancel={handleCancel}
  prompt="/ "
  placeholder="type to filter…"
  isActive={filterOpen}
/>
```

**Key details:**

- Handles Backspace, Ctrl+U (clear), Return (submit), Escape (cancel) internally.
- `isActive={false}` disables all input handling (pass this when the input shouldn't capture keys).
- Shows a blinking cursor character (default `█`) at the end of the value.

### ScrollView\<T\>

Virtual-scrolling list for non-tabular data.

```tsx
import { ScrollView } from "../primitives/ScrollView.js";

<ScrollView
  items={entries}
  renderItem={(item, i) => <Text key={item.id}>{item.label}</Text>}
  keyExtractor={(item) => item.id}
  cursorIndex={cursor}
  height={20}
  scrollIndicator
/>
```

**Key details:**

- Reserves `headerRows` and `footerRows` from available height.
- When `scrollIndicator={true}`, shows `↑`, `↓`, or `↑↓` at the bottom when content overflows.

### Cell

Fixed-width text cell with alignment and truncation.

```tsx
import { Cell } from "../primitives/Cell.js";

<Cell width={12} align="right" bold color="green">
  {formattedValue}
</Cell>
```

**Key details:**

- Always `flexShrink={0}, flexGrow={0}` — it holds its width.
- Truncation default is `"end"` (also supports `"start"` and `"middle"`).
- Accepts all Ink `<Text>` styling props (color, bold, dim, inverse, etc.).

---

## Theme System

### Using the Theme

```tsx
import { useTheme } from "../theme/context.js";

function MyComponent() {
  const theme = useTheme();

  // Colors — keyed by role
  const spec = theme.colors.running;   // { color: "blue" }
  const dim  = theme.colors.dim;       // { dim: true }

  // Glyphs — keyed by glyph name
  const glyph = theme.glyphs.ok;       // "✓" (or "[ok]" in ASCII mode)

  // Frame characters
  const vert = theme.frame.v;          // "║" (or "|")

  // Capabilities
  const isUnicode = theme.capabilities.unicode;
  const hasColor  = theme.capabilities.color;
}
```

### Color Roles

| Status roles | Color | Use for |
|---|---|---|
| `pending` | dim | Queued steps |
| `running` | blue | Active steps |
| `complete` | green | Successful completion |
| `failed` | red | Errors |
| `skipped` | gray dim | Skipped/pruned steps |
| `waiting` | yellow | Approval gates |
| `retrying` | yellow | Retry in progress |
| `timeout` | red | Timed-out steps |
| `batch` | magenta | forEach aggregate rows |
| `route` | cyan dim | Edge/routing info |

| Chrome roles | Color | Use for |
|---|---|---|
| `accent` | cyan | UI highlights |
| `dim` | dim | De-emphasized text |
| `danger` | red | Destructive actions |

### Glyph Keys

| Key | Unicode | ASCII | Use for |
|---|---|---|---|
| `pending` | ⊙ | [pend] | Queued |
| `running` | ▶ | [run] | In progress |
| `ok` | ✓ | [ok] | Success |
| `fail` | ✗ | [fail] | Error |
| `skipped` | ○ | [skip] | Skipped |
| `waiting` | ⏸ | [wait] | Approval |
| `retry` | ↻ | [retry] | Retrying |
| `timeout` | ⏱ | [time] | Timeout |
| `batch` | ⟳ | [batch] | Aggregate |
| `arrow` | → | -> | Edge label |
| `progressFilled` | █ | # | Progress bar |
| `progressEmpty` | ░ | . | Progress bar |

### Applying Theme to Cells

The standard pattern for themed status cells in DataTable:

```tsx
function toDataTableColumns(
  columns: ReadonlyArray<MyColumn>,
  theme: Theme,
): ReadonlyArray<ColumnDef<MyRow>> {
  return columns.map((col) => {
    const base: ColumnDef<MyRow> = {
      id: col.id,
      header: col.header,
      width: col.grow ? undefined : col.width,
      grow: col.grow,
      align: col.align,
      render: (row) => col.projectText(row),
    };

    if (col.id === "status") {
      return {
        ...base,
        renderCell: (row: MyRow) => {
          const glyph = theme.glyphs[row.glyphKey];
          const spec = theme.colors[row.role];
          return (
            <Text
              color={spec.color}
              dimColor={spec.dim === true}
              wrap="truncate-end"
            >
              {glyph} {row.statusLabel}
            </Text>
          );
        },
      };
    }

    return base;
  });
}
```

Call this inside the component with `useMemo` over `[columns, theme]`.

---

## Rules and Constraints

### No React.memo on Components with useInput

React 19.2's `useEffectEvent` (used internally by Ink 7's `useInput`) fails to update the effect-event ref inside `SimpleMemoComponent` fibers. This causes `useInput` closures to capture stale state.

```tsx
// BAD — useInput will see stale props/state
const MyTable = React.memo(function MyTable(props) {
  useInput((input, key) => { /* stale closure */ });
  return <DataTable ... />;
});

// GOOD — direct function export
export function MyTable(props) {
  useInput((input, key) => { /* fresh closure */ });
  return <DataTable ... />;
}
```

React.memo is fine for **passive** (display-only) components that never call `useInput`.

### Conditional Display Prop

Never pass `display={undefined}` to an Ink `<Box>`. Use a conditional spread:

```tsx
// BAD
<Box display={isVisible ? "flex" : undefined} />

// GOOD
<Box {...(isVisible ? {} : { display: "none" as const })} />
```

### Height Budgeting

When composing DataTable inside a container with chrome (filter bars, footers, headers):

```tsx
const nonTableOverhead = (filterOpen ? FILTER_BAR_ROWS : 0) + FOOTER_ROWS;
const dataHeight = Math.max(0, paneHeight - nonTableOverhead);
const pageSize = Math.max(0, dataHeight - 1); // minus DataTable's own header
```

DataTable renders its own header row — don't subtract header rows from its height externally.

### Pure Module Discipline

Modules in `runs/`, `steps/`, `state/`, `engine/`, `theme/` (except `context.tsx`) must not import from `ink`, `react`, `node:fs`, or `node:child_process`. This is enforced by `test/state/purity.test.ts`. Keep derivation, sorting, filtering, and type definitions in these pure modules; put React/Ink code in `components/`.

### AppShell Frame Technique

The app shell uses a hybrid approach:

1. **Top/bottom/splitter edges** — pre-composed strings (`╔═══╗`, `╠═══╣`, `╚═══╝`) rendered as `<Text>`.
2. **Left/right borders** — Ink's `borderStyle` on content Boxes (`borderLeft={true}, borderRight={true}, borderTop={false}, borderBottom={false}`).
3. **Mode tabs overlay** — `<Box marginTop={-1} marginLeft={2}>` positions tabs on top of the top-edge row.
4. **Slot heights** — `pickFrameSlots(rows)` reserves 4 chrome rows and splits the rest 50/50.

This preserves exact junction characters (`╠═╣`) that Ink's border system can't produce while using Yoga for content layout.

---

## Patterns Cheatsheet

### Adding a New Table View

1. Define row type in `src/<module>/types.ts` (pure module).
2. Define column definitions in `src/<module>/columns.ts` (pure module) — each column gets `id`, `header`, `width` or `grow`, `projectText(row) → string`.
3. Add `pickColumnSet(width)` for responsive tiers if needed (wide ≥120, medium ≥90, narrow <90).
4. Write the component in `src/components/<view>.tsx`:
   - Call `pickColumnSet(width)` for responsive columns.
   - Write a `toDataTableColumns(columns, theme)` adapter with `renderCell` for themed cells.
   - Wrap adapter in `useMemo([columns, theme])`.
   - Render `<DataTable<T>>` with the adapted columns.
5. Test column definitions (pure) separately from the component (Ink render).

### Adding a Two-Pane Layout

```tsx
<SplitPane direction="row" ratio={0.6} divider
           width={width} height={height}
           minFirst={25} minSecond={25}>
  <ListPane width={leftWidth} height={height} />
  <DetailPane width={rightWidth} height={height} />
</SplitPane>
```

Compute `leftWidth` / `rightWidth` explicitly if children need them for text budget calculations.

### Adding a Modal Dialog

```tsx
<Modal visible={showModal} title="Confirm" onClose={() => setShow(false)}>
  <Box flexDirection="column" gap={1}>
    <Text>Are you sure?</Text>
    <TextInput value={input} onChange={setInput} onSubmit={confirm} isActive={showModal} />
  </Box>
</Modal>
```

Set `isActive` on TextInput to match modal visibility so keys don't leak.

### Themed Status Display (Outside Tables)

```tsx
const theme = useTheme();
const glyph = theme.glyphs[glyphKeyForRole(status)];
const spec = theme.colors[status];

<Text color={spec.color} dimColor={spec.dim === true}>
  {glyph} {label}
</Text>
```

---

## Testing

- **Pure modules** — standard Vitest, no Ink dependency. Import and test derivation, sorting, filtering functions directly.
- **Components** — use `ink-testing-library`'s `render()`. Wrap in `<ThemeProvider>`. Use `stripAnsi()` on `lastFrame()` for text assertions.
- **Ink renderer limitations** — `position="absolute"` doesn't render in test frames. Keep that in mind when testing modals or overlays.
- **Perf budgets** — tunable via `MARKFLOW_PERF_MULT` env var. Set `CI_SKIP_PERF=1` to skip perf tests.
