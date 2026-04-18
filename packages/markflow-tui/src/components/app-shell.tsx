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
// Uses Ink's borderStyle for left/right borders (║) on each content
// row, eliminating manual "║ spaces ║" string generation and the
// marginTop overlay technique for slot content. The top edge, splitter,
// and bottom edge remain pre-composed strings to preserve the exact
// ╔═╗ / ╠═╣ / ╚═╝ junction characters.

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
  readonly top: React.ReactNode;
  readonly bottom: React.ReactNode;
  readonly keybar?: React.ReactNode;
  readonly modeTabs: React.ReactNode;
  readonly narrow?: boolean;
  readonly breadcrumb?: string;
  readonly singleSlot?: React.ReactNode;
  readonly mode?: AppState["mode"];
  readonly selectedRunId?: string | null;
  readonly width?: number;
  readonly height?: number;
}

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 30;

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

  const frame = theme.frame;
  const innerWidth = Math.max(0, cols - 2);
  const borderStyleStr = (
    theme.capabilities.unicode ? "double" : "classic"
  ) as "double" | "classic";

  // P8-T2 narrow branch — single-pane layout with breadcrumb title.
  if (narrow === true) {
    const fullRows = Math.max(1, rows - 2);
    const titleBudget = Math.max(0, cols - 4);
    let title = breadcrumb ?? "";
    if (title.length > titleBudget) {
      title =
        titleBudget <= 1
          ? "\u2026"
          : "\u2026" + title.slice(title.length - (titleBudget - 1));
    }
    const narrowTopEdge = composeTopRow(cols, title, frame);
    const narrowBottomEdge = `${frame.bl}${frame.h.repeat(innerWidth)}${frame.br}`;

    return (
      <Box flexDirection="column" height={rows}>
        <Text>{narrowTopEdge}</Text>
        <Box
          borderStyle={borderStyleStr}
          borderTop={false}
          borderBottom={false}
          borderLeft={true}
          borderRight={true}
          height={fullRows}
          overflow="hidden"
          flexDirection="column"
        >
          {singleSlot}
        </Box>
        <Text>{narrowBottomEdge}</Text>
        {keybar ? <Box>{keybar}</Box> : null}
      </Box>
    );
  }

  // Top-edge title
  let title: string;
  if (mode !== undefined) {
    const active: ModeTabKey = activeTabFromMode(mode);
    const hideRun =
      mode.kind === "browsing" && (selectedRunId ?? null) === null;
    title = frameTitle(active, { hideRun });
  } else {
    title = "WORKFLOWS  RUNS  RUN";
  }

  const { topRows, bottomRows } = pickFrameSlots(rows);
  const topEdge = composeTopRow(cols, title, frame);
  const splitterEdge = `${frame.mid_l}${frame.mid_h.repeat(innerWidth)}${frame.mid_r}`;
  const bottomEdge = `${frame.bl}${frame.h.repeat(innerWidth)}${frame.br}`;

  return (
    <Box flexDirection="column" height={rows}>
      {/* Top edge (plain chrome with title baked in) */}
      <Text>{topEdge}</Text>

      {/* Mode-tabs overlay — positioned on the top-edge row, 2 cols from
          the left to account for `╔` + one space padding. */}
      <Box marginTop={-1} marginLeft={2}>
        {modeTabs}
      </Box>

      {/* Top slot — Ink draws ║ borders on each content row */}
      <Box
        borderStyle={borderStyleStr}
        borderTop={false}
        borderBottom={false}
        borderLeft={true}
        borderRight={true}
        height={topRows}
        overflow="hidden"
        flexDirection="column"
      >
        {top}
      </Box>

      {/* Splitter — pre-composed ╠═══╣ string */}
      <Text>{splitterEdge}</Text>

      {/* Bottom slot */}
      <Box
        borderStyle={borderStyleStr}
        borderTop={false}
        borderBottom={false}
        borderLeft={true}
        borderRight={true}
        height={bottomRows}
        overflow="hidden"
        flexDirection="column"
      >
        {bottom}
      </Box>

      {/* Bottom edge */}
      <Text>{bottomEdge}</Text>

      {/* Keybar (outside the frame) */}
      {keybar ? <Box>{keybar}</Box> : null}
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const AppShell = AppShellImpl;
