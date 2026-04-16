// src/components/run-detail-placeholder.tsx
//
// Placeholder component for the bottom-pane detail area (P5-T3). Renders
// one of four flavours of plain-text message:
//
//   - follow mode, with id      → "selected: <runId> (detail pane — Phase 6)"
//   - follow mode, no id        → "no run selected (↑↓ to pick a row)"
//   - zoom mode, with id        → "RUN <runId> — detail pane (Phase 6)"
//   - zoom mode, run deleted    → "run <runId> no longer exists — Esc to return"
//
// Height is padded with blank lines to reach `height` rows so the pane
// reserves its vertical footprint in both layouts (mockups.md §1 bottom
// half + §4 full-height RUN mode).
//
// Phase-6 detail tabs, log pane, step table are intentionally NOT rendered
// — they land in Phase 6. See docs/tui/plans/P5-T3.md §7 + §12.
//
// Width/height as props (no process.stdout reads).

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";

export interface RunDetailPlaceholderProps {
  readonly selectedRunId: string | null;
  /** `false` when `selectedRunId` no longer appears in the feed. */
  readonly runExists: boolean;
  readonly mode: "follow" | "zoom";
  readonly width: number;
  readonly height: number;
}

const ELLIPSIS = "\u2026"; // …

function truncateId(id: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (id.length <= maxLen) return id;
  if (maxLen === 1) return ELLIPSIS;
  return id.slice(0, maxLen - 1) + ELLIPSIS;
}

function composeMessage(props: RunDetailPlaceholderProps): string {
  const { selectedRunId, runExists, mode, width } = props;
  // Reserve a little padding (`  ` margins) for the id budget.
  const idBudget = Math.max(4, width - 40);

  if (mode === "follow") {
    if (selectedRunId === null) {
      return "no run selected (\u2191\u2193 to pick a row)";
    }
    const id = truncateId(selectedRunId, idBudget);
    return `selected: ${id} (detail pane \u2014 Phase 6)`;
  }

  // zoom
  if (selectedRunId === null) {
    return "no run selected (Esc to return)";
  }
  if (!runExists) {
    const id = truncateId(selectedRunId, idBudget);
    return `run ${id} no longer exists \u2014 Esc to return`;
  }
  const id = truncateId(selectedRunId, idBudget);
  return `RUN ${id} \u2014 detail pane (Phase 6)`;
}

function RunDetailPlaceholderImpl(
  props: RunDetailPlaceholderProps,
): React.ReactElement | null {
  const theme = useTheme();
  const { width, height } = props;

  if (width <= 0 || height <= 0) {
    // Defensive: render nothing rather than crash on degenerate layouts.
    return null;
  }

  const message = composeMessage(props);
  // Reserve the first row for the message; pad with blank lines to `height`.
  const padRows = Math.max(0, height - 1);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={theme.colors.dim.color}
        dimColor={theme.colors.dim.dim === true}
      >
        {message}
      </Text>
      {Array.from({ length: padRows }, (_, idx) => (
        <Text key={`pad-${idx}`}> </Text>
      ))}
    </Box>
  );
}

export const RunDetailPlaceholder = React.memo(RunDetailPlaceholderImpl);
RunDetailPlaceholder.displayName = "RunDetailPlaceholder";
