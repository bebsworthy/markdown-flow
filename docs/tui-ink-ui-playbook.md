# `@inkjs/ui` 2.x Playbook

Practical reference for `@inkjs/ui@2.0.0`, the prebuilt component library for Ink.
Grounded against the installed copy in this repo (`markflow-tui` uses ink `^7.0.1`,
react `^19.2.5`, `@inkjs/ui` `^2.0.0`).

Primary sources:
- Repo: <https://github.com/vadimdemedes/ink-ui>
- README: <https://github.com/vadimdemedes/ink-ui/blob/main/readme.md>
- Docs dir: <https://github.com/vadimdemedes/ink-ui/tree/main/docs>
- v2.0.0 release: <https://github.com/vadimdemedes/ink-ui/releases/tag/v2.0.0>
- npm: <https://www.npmjs.com/package/@inkjs/ui>

The barrel export is `source/index.ts`
(<https://github.com/vadimdemedes/ink-ui/blob/main/source/index.ts>). There is **one
top-level entry** — everything is imported from `@inkjs/ui` (no deep paths).

---

## 1. Version, engines, peer deps

From `@inkjs/ui@2.0.0/package.json`:

| Field | Value |
|---|---|
| `engines.node` | `>=18` |
| `peerDependencies.ink` | `>=5` |
| Built against (dev) | `ink@^5.0.0`, `react@^18.3.1` |
| Runtime deps | `chalk ^5`, `cli-spinners ^3`, `deepmerge ^4`, `figures ^6` |
| ESM only | `"type": "module"`, single `exports["."]` |

### 1.x → 2.x breaking change

Only one bullet in the v2 release notes: **"Require Node.js 18 and Ink 5"**. No API
removals, no renamed props. If your 1.x code targeted Node 16 / Ink 4, the upgrade is
an engine bump only.

### Ink 7 / React 19 compatibility (our stack)

`@inkjs/ui@2.0.0` declares `peerDependencies.ink: ">=5"`, so npm is happy against ink
7. The `@types/react` dep in the library is `^18.3.2`, but the library's runtime API
surface is plain function components that accept `children: ReactNode` — there is no
React-18-specific behavior. In practice it works on React 19; the one sharp edge is
the deprecated `defaultProps` warning React 19 prints for a few internal spots (see
§7 "Known gaps").

If TypeScript complains about `@types/react` version skew, pin at the workspace root
via `overrides` or `resolutions`; do not fork the lib.

---

## 2. Exhaustive component list

All 13 components exported from `@inkjs/ui@2.0.0`
(<https://github.com/vadimdemedes/ink-ui/blob/main/source/index.ts>):

| Category | Components |
|---|---|
| Input | `TextInput`, `EmailInput`, `PasswordInput`, `ConfirmInput` |
| Selection | `Select`, `MultiSelect` |
| Feedback | `Spinner`, `ProgressBar` |
| Status / callouts | `Badge`, `StatusMessage`, `Alert` |
| Lists | `UnorderedList` (+ `.Item`), `OrderedList` (+ `.Item`) |

Theming API (also exported from the barrel): `ThemeProvider`, `defaultTheme`,
`extendTheme`, `useComponentTheme`, and types `Theme`, `ComponentTheme`,
`ComponentStyles`, `ThemeProviderProps`, plus the shared `Option` type from
`./types.js` (used by `Select` / `MultiSelect`).

There is **no** `Tabs`, `Table`, `Dialog`, `Modal`, `Pager`, `Tree`, `Link`, or
masked generic `Input` component. Those are the most common gaps — see §7.

---

## 3. Components

### 3.1 `TextInput`

Single-line input with optional case-sensitive autocomplete.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/text-input.md>

```ts
type TextInputProps = {
  isDisabled?: boolean;        // default false — ignores key input when true
  placeholder?: string;        // shown while empty
  defaultValue?: string;       // initial value (uncontrolled)
  suggestions?: string[];      // autocomplete; match is case-sensitive
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void; // fired on Enter
};
```

Notes:
- **Uncontrolled** — no `value` prop. Mirror to state via `onChange` if you need to
  read it outside.
- Disable to multiplex focus across several inputs (set `isDisabled` on all but the
  focused one — see MultiSelect example below for the idiom).

```tsx
import {TextInput} from '@inkjs/ui';

<TextInput
  placeholder="Workflow name…"
  defaultValue="my-flow"
  suggestions={['deploy', 'deploy-staging', 'deploy-prod']}
  onChange={setName}
  onSubmit={submit}
/>
```

### 3.2 `EmailInput`

TextInput variant that autocompletes the domain after the user types `@`.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/email-input.md>

```ts
type EmailInputProps = {
  isDisabled?: boolean;
  placeholder?: string;
  defaultValue?: string;
  domains?: string[]; // default: aol/gmail/yahoo/hotmail/live/outlook/icloud/hey
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};
```

```tsx
<EmailInput placeholder="Email…" domains={['example.com', 'example.org']} onSubmit={save}/>
```

### 3.3 `PasswordInput`

Masks the entered text. No autocomplete, no `defaultValue`, no `suggestions`.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/password-input.md>

```ts
type PasswordInputProps = {
  isDisabled?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};
```

### 3.4 `ConfirmInput`

`Y/n` prompt. Important: **no `children` / no label** — render your question next to
it yourself.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/confirm-input.md>

```ts
type ConfirmInputProps = {
  isDisabled?: boolean;
  defaultChoice?: 'confirm' | 'cancel'; // default 'confirm'
  submitOnEnter?: boolean;              // default true — Enter applies defaultChoice
  onConfirm: () => void;                // REQUIRED
  onCancel: () => void;                 // REQUIRED
};
```

Set `submitOnEnter={false}` when you want an explicit `Y` / `N` keypress (e.g. for
destructive actions).

```tsx
<Box>
  <Text>Delete run? (Y/n) </Text>
  <ConfirmInput submitOnEnter={false} onConfirm={remove} onCancel={dismiss}/>
</Box>
```

### 3.5 `Select`

Scrollable single-select. Arrow keys navigate, Enter/Space commits.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/select.md>

```ts
type Option = { label: string; value: string };

type SelectProps = {
  isDisabled?: boolean;        // default false
  visibleOptionCount?: number; // default 5 — window height
  highlightText?: string;      // substring to bold inside labels (filter affordance)
  options: Option[];
  defaultValue?: string;
  onChange?: (value: string) => void;
};
```

Notes:
- There is **no `onSubmit`** on `Select` — `onChange` fires on commit. If you want
  Enter to both commit and advance a wizard, wire that into `onChange`.
- `highlightText` only highlights — it does **not** filter. Filter `options` yourself.

```tsx
<Select
  visibleOptionCount={8}
  highlightText={query}
  options={workflows.map(w => ({label: w.name, value: w.id}))}
  onChange={pickWorkflow}
/>
```

### 3.6 `MultiSelect`

Same as `Select` but collects an array. Space toggles, Enter submits.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/multi-select.md>

```ts
type MultiSelectProps = {
  isDisabled?: boolean;
  visibleOptionCount?: number; // default 5
  highlightText?: string;
  options: Option[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  onSubmit?: (value: string[]) => void; // fires on Enter
};
```

Two-step focus idiom (from the docs) — disable the inactive one:

```tsx
<MultiSelect isDisabled={active !== 'primary'} options={colors} onChange={setPrimary}
  onSubmit={() => setActive('secondary')}/>
<MultiSelect isDisabled={active !== 'secondary'} options={colors} onChange={setSecondary}
  onSubmit={() => setActive('done')}/>
```

### 3.7 `Spinner`

Animated frame + optional label. Uses [`cli-spinners`](https://github.com/sindresorhus/cli-spinners).
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/spinner.md>

```ts
import type {SpinnerName} from 'cli-spinners';

type SpinnerProps = {
  label?: string;
  type?: SpinnerName; // default 'dots' — undocumented in the README but real
};
```

The `type` prop is on the installed `.d.ts` (via `UseSpinnerProps`) even though the
README only mentions `label`. Any `cli-spinners` name works: `dots`, `line`, `arc`,
`bouncingBar`, `earth`, `clock`, etc.

```tsx
<Spinner label="Running step…" type="arc"/>
```

### 3.8 `ProgressBar`

Simple horizontal bar. Stretches to fill its parent's `width`.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/progress-bar.md>

```ts
type ProgressBarProps = {
  value: number; // 0–100, default 0 — clamped
};
```

No `label`, no `showPercentage`. Compose yourself:

```tsx
<Box width={40} gap={1}>
  <Box width={30}><ProgressBar value={pct}/></Box>
  <Text>{pct}%</Text>
</Box>
```

### 3.9 `Badge`

Inline colored pill, rendered as text on a background.

```ts
import type {TextProps} from 'ink';

type BadgeProps = {
  children: ReactNode;
  color?: TextProps['color']; // default 'magenta' — any Ink color (name, #hex, ansi-256)
};
```

```tsx
<Badge color="green">PASS</Badge>
<Badge color="red">FAIL</Badge>
<Badge color="#7f7f7f">SKIPPED</Badge>
```

### 3.10 `StatusMessage`

One-line status with a leading glyph.
Docs: <https://github.com/vadimdemedes/ink-ui/blob/main/docs/status-message.md>

```ts
type StatusMessageVariant = 'success' | 'error' | 'warning' | 'info';
type StatusMessageProps = { children: ReactNode; variant: StatusMessageVariant };
```

Glyph + color are picked by variant (see theme section). `variant` is required — no
default.

```tsx
<StatusMessage variant="success">Deployed</StatusMessage>
<StatusMessage variant="error">Build failed</StatusMessage>
```

### 3.11 `Alert`

Boxed callout for longer messages. Has an optional `title`.

```ts
type AlertProps = {
  children: ReactNode;
  variant: 'info' | 'success' | 'error' | 'warning';
  title?: string; // rendered above the message
};
```

```tsx
<Alert variant="warning" title="Deprecation">
  This CLI version is deprecated. Upgrade before Q3.
</Alert>
```

### 3.12 `UnorderedList` / `OrderedList`

Both use the `.Item` sub-component pattern and nest arbitrarily. Children of `.Item`
are plain Ink (`<Text>`, `<Box>`, nested lists, etc.).

```ts
type ListProps = { children: ReactNode };            // both
// .Item accepts ReactNode children only
```

```tsx
<UnorderedList>
  <UnorderedList.Item><Text>Red</Text></UnorderedList.Item>
  <UnorderedList.Item>
    <Text>Green</Text>
    <UnorderedList>
      <UnorderedList.Item><Text>Light</Text></UnorderedList.Item>
      <UnorderedList.Item><Text>Dark</Text></UnorderedList.Item>
    </UnorderedList>
  </UnorderedList.Item>
</UnorderedList>
```

The marker (bullet / numbering prefix) is not a prop — change it via theme
(`config.marker`). See §4.

---

## 4. Theming API

Source: <https://github.com/vadimdemedes/ink-ui/blob/main/source/theme.tsx>

### Shape

```ts
type Theme = { components: Record<string, ComponentTheme> };

type ComponentTheme = {
  styles?: Record<string, (props?: any) => ComponentStyles>; // return Ink BoxProps / TextProps
  config?: (props?: any) => Record<string, unknown>;         // non-style knobs (e.g. marker)
};

type ComponentStyles = Record<string, unknown>;
```

Every built-in component reads from a keyed entry in `defaultTheme.components`:
`Alert`, `Badge`, `ConfirmInput`, `MultiSelect`, `OrderedList`, `ProgressBar`,
`Select`, `Spinner`, `StatusMessage`, `UnorderedList`, `TextInput`, `EmailInput`,
`PasswordInput`.

### Primitives

- `defaultTheme: Theme` — the built-in theme.
- `extendTheme(base, override)` — `deepmerge`s two themes. Style functions on the
  same key are overwritten (deepmerge replaces functions), not chained.
- `ThemeProvider` — React context provider. Wrap whatever subtree should use the
  theme. Nest providers freely; inner wins.
- `useComponentTheme<T>(name)` — reads the entry for `name` from context, typed as
  `T extends ComponentTheme`.

### Override a built-in (recipe)

```tsx
import {render, type TextProps, type BoxProps} from 'ink';
import {Spinner, ThemeProvider, extendTheme, defaultTheme} from '@inkjs/ui';

const theme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        container: (): BoxProps => ({gap: 1}),
        frame:     (): TextProps => ({color: 'magenta'}),
        label:     (): TextProps => ({dimColor: true}),
      },
    },
    Badge: {
      styles: {
        container: ({color}: {color: string}): BoxProps => ({
          backgroundColor: color,
          paddingX: 1,
        }),
      },
    },
    UnorderedList: {
      config: () => ({marker: '─'}), // non-style knob
    },
  },
});

render(
  <ThemeProvider theme={theme}>
    <Spinner label="Working"/>
  </ThemeProvider>,
);
```

Key rule: **style functions receive the relevant props** (e.g. the `Badge` style
function gets `{color}`, the `StatusMessage` icon style gets `{variant}`). The
parameters you'll see for each component are exactly the inputs that the component's
render path varies on.

### Observed style-function signatures

Derived from the README + `source/theme.tsx`:

| Component | `styles` keys | Props passed | `config` keys |
|---|---|---|---|
| `Spinner` | `container`, `frame`, `label` | — | — |
| `StatusMessage` | `icon` (and siblings) | `{variant}` | — |
| `Badge` | `container`, `label` | `{color}` | — |
| `UnorderedList` / `OrderedList` | item/marker styles | — | `marker` |
| `Alert`, `ConfirmInput`, `Select`, `MultiSelect`, `TextInput`, `EmailInput`, `PasswordInput`, `ProgressBar` | various | variant / state where relevant | — |

The surest move when customizing: read
`node_modules/@inkjs/ui/build/components/<name>/theme.js` — the shipped theme is the
spec.

### Build your own themed component

Use the same primitives to get per-app theme support for free:

```tsx
import {render, Text, type TextProps} from 'ink';
import {
  ThemeProvider, defaultTheme, extendTheme, useComponentTheme,
  type ComponentTheme,
} from '@inkjs/ui';

const customLabelTheme = {
  styles: { label: (): TextProps => ({color: 'green'}) },
} satisfies ComponentTheme;
type CustomLabelTheme = typeof customLabelTheme;

const theme = extendTheme(defaultTheme, {
  components: { CustomLabel: customLabelTheme },
});

function CustomLabel() {
  const {styles} = useComponentTheme<CustomLabelTheme>('CustomLabel');
  return <Text {...styles.label()}>Hello</Text>;
}

render(<ThemeProvider theme={theme}><CustomLabel/></ThemeProvider>);
```

---

## 5. Composition patterns

### 5.1 Wrap a component to freeze props

```tsx
export const AppSpinner = ({label}: {label?: string}) =>
  <Spinner type="arc" label={label ?? 'Loading'}/>;
```

Simple, no theme dance. Use for app-specific presets.

### 5.2 Per-subtree theme override

You can nest `ThemeProvider`s. This is the right tool when one screen needs
different colors — e.g. a "dangerous" area with red `StatusMessage` info variant:

```tsx
<ThemeProvider theme={baseTheme}>
  <MainScreen/>
  <ThemeProvider theme={dangerTheme}>
    <DeleteConfirmation/>
  </ThemeProvider>
</ThemeProvider>
```

### 5.3 Focus routing over multiple inputs

The library's inputs don't integrate with Ink's `useFocus`. They listen globally when
mounted. To multiplex focus, **always use `isDisabled`** — not conditional mount —
so transitions don't drop pending state. See the TextInput / MultiSelect disabled
examples above.

### 5.4 Controlled-ish pattern

All inputs are uncontrolled (no `value` prop). If you need to reset:
- remount via a `key` prop, **or**
- drive the user toward a new screen and rely on `defaultValue` on mount.

There is no imperative `ref.clear()` API.

---

## 6. What's new in 2.x vs 1.x

- **Only documented breaking change:** Node ≥ 18, Ink ≥ 5
  (<https://github.com/vadimdemedes/ink-ui/releases/tag/v2.0.0>).
- No new components were added in 2.0 itself (the jump was mostly the engine bump).
- The component set has been stable since 1.0. The full list in `source/index.ts`
  today matches what 2.0 shipped.

Migrating 1.x code: bump Node/Ink, reinstall, done. No codemods needed.

---

## 7. Known gaps — when to drop to raw Ink

Reach for raw `ink` (or a sibling package) when you need any of the following:

| Need | `@inkjs/ui` support | Workaround |
|---|---|---|
| Tables / columns | none | `<Box flexDirection="row">` + width allocation; or `ink-table` |
| Tabs | none | hand-rolled with `useInput` + indexed render |
| Modal / dialog | none | full-screen `<Box>` with manual focus capture |
| Hyperlink | none | `ink-link` |
| Syntax highlighting | none | `ink-syntax-highlight` |
| Big ascii text | none | `ink-big-text`, `ink-gradient` |
| Markdown render | none | `ink-markdown` |
| Scrolling viewport | none (ProgressBar stretches but doesn't scroll) | compute window yourself; Ink has no virtual scroll |
| Label next to `ProgressBar` | no `label` prop | compose with `<Box>` + `<Text>` |
| Filter `Select` options | `highlightText` only highlights | filter `options` in a `useMemo` |
| `onSubmit` on `Select` | missing | use `onChange`, or wrap in your own key listener |
| Controlled inputs (`value` prop) | all inputs are uncontrolled | remount with `key`, or mirror via `onChange` |
| Masked generic input | only `PasswordInput` | fork `PasswordInput` or use `ink-text-input` |
| Form validation / error slots | none | render your own `<StatusMessage>` underneath |
| Cursor styling inside inputs | not exposed | raw Ink only |
| Focus integration with `useFocus` | inputs capture globally while mounted | gate with `isDisabled={!isFocused}` |

React 19 gotchas observed in practice:
- `defaultProps` on function components is deprecated — you may see a warning from
  deep inside `@inkjs/ui`. Harmless; filter via `process.env.CI` log suppression or
  ignore.
- Strict-mode double-invocation can double-render spinner frames in tests; render
  under the normal `<Ink>` root, not `<StrictMode>`.

---

## 8. Quick import cheat sheet

```ts
import {
  // components
  Alert, Badge, ConfirmInput, EmailInput, MultiSelect,
  OrderedList, PasswordInput, ProgressBar, Select, Spinner,
  StatusMessage, TextInput, UnorderedList,

  // theming
  ThemeProvider, defaultTheme, extendTheme, useComponentTheme,

  // types
  type Theme, type ComponentTheme, type ComponentStyles,
  type ThemeProviderProps, type Option,

  // per-component prop types (useful for wrappers)
  type AlertProps, type BadgeProps, type ConfirmInputProps,
  type EmailInputProps, type MultiSelectProps, type OrderedListProps,
  type PasswordInputProps, type ProgressBarProps, type SelectProps,
  type SpinnerProps, type StatusMessageProps, type TextInputProps,
  type UnorderedListProps,
} from '@inkjs/ui';
```

All names are exported from the single entry. No subpath imports.

---

## 9. Decision checklist for this repo

Before pulling in a fourth-party component or rolling our own:

1. Is there a direct `@inkjs/ui` match? (§3, §8)
2. If close-but-not-quite, can theme (§4) or simple composition (§5) bridge it?
3. If it's in the "gaps" table (§7), don't stretch `@inkjs/ui` — use raw Ink or a
   sibling `ink-*` package. Do not shadow-fork `@inkjs/ui` components in-tree.
4. Per-screen overrides: nest `ThemeProvider`. Per-app overrides: one
   `ThemeProvider` at the root in `app.tsx`.
