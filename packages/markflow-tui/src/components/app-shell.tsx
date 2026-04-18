// src/components/app-shell.tsx
//
// The outer app-shell frame. Renders:
//
//   ╔ <mode-tabs row> ═══════════════════════════════════════════════╗
//   ║ <top slot>                                                     ║
//   ╠════════════════════════════════════════════════════════════════╣
//   ║ <bottom slot>                                                  ║
//   ╚════════════════════════════════════════════════════════════════╝
//   <keybar — outside the frame>
//
// Authoritative references:
//   - docs/tui/plans/P3-T5.md §2.1, §3
//   - docs/tui/features.md §5.6, §5.10
//   - docs/tui/mockups.md §1, §4, §6, §14
//
// Design notes:
//   - All frame glyphs come from `theme.frame` (UNICODE_FRAME / ASCII_FRAME
//     per capability detection). No box-drawing literal appears in this file.
//   - `width` and `height` are props so that ink-testing-library (which
//     has a default stdout of 100 cols) can render arbitrary widths. The
//     shell emits each chrome row as a single pre-composed string via
//     `<Text>` — this bypasses Ink's flex-box sizing which would otherwise
//     clamp to stdout.columns. Same precedent as the `Keybar` primitive
//     (P3-T4) which also uses `width` only to choose content, never to
//     bound a container.
//   - The component does NOT own `useInput`. Mode-tab key dispatch lives
//     in `<ModeTabs>`; any additional app-wide key handling lives in
//     `<App>`.
//
// Top-edge composition:
//   The first row is rendered as two siblings stacked with `marginTop={-1}`:
//     1. A plain `<Text>` containing `╔ TITLE ═══...╗` where TITLE is the
//        rendered (plain-text) tab label row from `frameTitle()`. This
//        fills the width completely with frame glyphs.
//     2. A second `<Box marginLeft={2} marginTop={-1}>` holding the
//        `<ModeTabs>` React subtree so the inverse-video pill can overlay
//        the active tab in the first row.
//   The second-row overlay replaces the plain characters under it while
//   leaving the `═` fill on either side intact — which matches mockups.md
//   §1 / §4 exactly.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import {
  activeTabFromMode,
  composeTopRow,
  frameTitle,
  pickFrameSlots,
  type ModeTabKey,
} from "./app-shell-layout.js";
import type { AppState } from "../state/types.js";

export interface AppShellProps {
  /** Top half of the frame — typically a runs table or workflow browser. */
  readonly top: React.ReactNode;
  /** Bottom half — tabbed pane (Graph / Detail / Log / Events) or preview. */
  readonly bottom: React.ReactNode;
  /**
   * Bottom-of-frame keybar (already-rendered `<Keybar/>` element). Optional;
   * callers without a keybar pass `null` or omit the prop.
   */
  readonly keybar?: React.ReactNode;
  /**
   * Mode-tabs overlay subtree (typically `<ModeTabs>`). Rendered inline
   * inside the top frame edge using a `marginTop={-1}` overlay.
   *
   * Under `narrow={true}` the overlay is NOT rendered — the top edge
   * hosts the breadcrumb instead.
   */
  readonly modeTabs: React.ReactNode;
  /**
   * When true, renders the <60-col single-pane layout (P8-T2):
   *   - no splitter row; one slot consumes the full frame body
   *   - `breadcrumb` replaces the mode-tabs overlay in the top edge
   *   - `top` / `bottom` / `modeTabs` are ignored; `singleSlot` is used
   *
   * Default false preserves the existing wide/medium two-pane render.
   */
  readonly narrow?: boolean;
  /**
   * Plain-text breadcrumb string for the top edge when `narrow === true`.
   * Composed by the caller via `composeBreadcrumb(...)`. Clamped here to
   * the available title budget.
   */
  readonly breadcrumb?: string;
  /** Single-slot body content when `narrow === true`. */
  readonly singleSlot?: React.ReactNode;
  /**
   * Drives the plain-text title in the top edge: the active tab is
   * wrapped in `[ ... ]` so the column positions align with the
   * `modeTabs` overlay. When omitted, defaults to the canonical
   * `WORKFLOWS  RUNS  RUN` label row with `RUN` as the active pill.
   */
  readonly mode?: AppState["mode"];
  /** Whether to render the RUN tab in the title. Follows hide-don't-grey. */
  readonly selectedRunId?: string | null;
  /**
   * Width override for tests. Defaults to 80 when neither this prop nor
   * `process.stdout.columns` resolves to a value.
   */
  readonly width?: number;
  /**
   * Height override for tests. Defaults to 30 when neither this prop nor
   * `process.stdout.rows` resolves to a value.
   */
  readonly height?: number;
}

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 30;

function slotLines(n: number): ReadonlyArray<string> {
  return Array.from({ length: n }, () => "");
}

function AppShellImpl({
  top,
  bottom,
  keybar,
  modeTabs,
  mode,
  selectedRunId,
  width,
  height,
  narrow,
  breadcrumb,
  singleSlot,
}: AppShellProps): React.ReactElement {
  const theme = useTheme();
  const cols = width ?? DEFAULT_WIDTH;
  const rows = height ?? DEFAULT_HEIGHT;

  const { topRows, bottomRows } = pickFrameSlots(rows);
  const frame = theme.frame;
  const innerWidth = Math.max(0, cols - 2);

  // ------------------------------------------------------------------------
  // P8-T2 narrow branch — single-pane layout with breadcrumb title.
  // ------------------------------------------------------------------------
  if (narrow === true) {
    // Total interior rows = `rows - 2` (top + bottom edges only, no
    // splitter). Guard against extreme low heights.
    const fullRows = Math.max(1, rows - 2);
    const titleBudget = Math.max(0, cols - 4);
    let title = breadcrumb ?? "";
    if (title.length > titleBudget) {
      // Defensive clamp — collapse from the left with an ellipsis.
      title = titleBudget <= 1 ? "\u2026" : "\u2026" + title.slice(title.length - (titleBudget - 1));
    }
    const narrowTopEdge = composeTopRow(cols, title, frame);
    const narrowBottomEdge = `${frame.bl}${frame.h.repeat(innerWidth)}${frame.br}`;
    const fullSlotShell = slotLines(fullRows).map(
      () => `${frame.v}${" ".repeat(innerWidth)}${frame.v}`,
    );

    return (
      <Box flexDirection="column" height={rows}>
        <Text>{narrowTopEdge}</Text>
        <Box flexDirection="column">
          {fullSlotShell.map((line, idx) => (
            <Text key={`full-shell-${idx}`}>{line}</Text>
          ))}
        </Box>
        {fullRows > 0 ? (
          <Box marginTop={-fullRows} marginLeft={1} flexDirection="column" height={fullRows} overflowY="hidden">
            {singleSlot}
          </Box>
        ) : null}
        <Text>{narrowBottomEdge}</Text>
        {keybar ? <Box>{keybar}</Box> : null}
      </Box>
    );
  }

  // Top-edge title:
  //   - If `mode` is provided, the active tab is derived from it.
  //   - Otherwise the title is just "WORKFLOWS  RUNS  RUN" with no pill —
  //     the default used by pure-chrome tests.
  let title: string;
  if (mode !== undefined) {
    const active: ModeTabKey = activeTabFromMode(mode);
    const hideRun =
      mode.kind === "browsing" && (selectedRunId ?? null) === null;
    title = frameTitle(active, { hideRun });
  } else {
    title = "WORKFLOWS  RUNS  RUN";
  }

  // Pre-composed chrome strings — each is exactly `cols` characters wide.
  const topEdge = composeTopRow(cols, title, frame);
  const splitterEdge = `${frame.mid_l}${frame.mid_h.repeat(innerWidth)}${frame.mid_r}`;
  const bottomEdge = `${frame.bl}${frame.h.repeat(innerWidth)}${frame.br}`;

  // Slot content rows — we render each interior row as a single `<Text>`
  // with the left and right `║` borders and a fixed inner width of spaces.
  // Children render as an overlay on the same rows via `marginTop`.
  const topSlotShell = slotLines(topRows).map(
    () => `${frame.v}${" ".repeat(innerWidth)}${frame.v}`,
  );
  const bottomSlotShell = slotLines(bottomRows).map(
    () => `${frame.v}${" ".repeat(innerWidth)}${frame.v}`,
  );

  return (
    <Box flexDirection="column" height={rows}>
      {/* Top edge (plain chrome with title baked in) */}
      <Text>{topEdge}</Text>

      {/* Mode-tabs overlay — positioned on the top-edge row, 2 cols from
          the left to account for `╔` + one space padding. */}
      <Box marginTop={-1} marginLeft={2}>
        {modeTabs}
      </Box>

      {/* Top slot — draw a border-only shell, then overlay the children. */}
      <Box flexDirection="column">
        {topSlotShell.map((line, idx) => (
          <Text key={`top-shell-${idx}`}>{line}</Text>
        ))}
      </Box>
      {topRows > 0 ? (
        <Box marginTop={-topRows} marginLeft={1} flexDirection="column" height={topRows} overflowY="hidden">
          {top}
        </Box>
      ) : null}

      {/* Splitter */}
      <Text>{splitterEdge}</Text>

      {/* Bottom slot */}
      <Box flexDirection="column">
        {bottomSlotShell.map((line, idx) => (
          <Text key={`bot-shell-${idx}`}>{line}</Text>
        ))}
      </Box>
      {bottomRows > 0 ? (
        <Box marginTop={-bottomRows} marginLeft={1} flexDirection="column" height={bottomRows} overflowY="hidden">
          {bottom}
        </Box>
      ) : null}

      {/* Bottom edge */}
      <Text>{bottomEdge}</Text>

      {/* Keybar (outside the frame) */}
      {keybar ? <Box>{keybar}</Box> : null}
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const AppShell = AppShellImpl;
