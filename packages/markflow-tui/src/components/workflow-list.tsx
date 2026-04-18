// src/components/workflow-list.tsx
//
// The left pane of the workflow browser. Pure rendering — no useInput.
// All layout decisions come from `src/browser/list-layout.ts`; this file
// just wraps each `ListRow` in styled <Text> tags.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { ListRow } from "../browser/list-layout.js";

export interface WorkflowListProps {
  readonly title: string;
  readonly rows: ReadonlyArray<ListRow>;
  readonly footer: string;
  readonly width: number;
  readonly height: number;
}

function toneColor(
  tone: ListRow["flagTone"],
  theme: ReturnType<typeof useTheme>,
): { color?: string; dim?: boolean } {
  // Tone → theme-color mapping per plan §5.
  // good → complete (green); bad → danger (red); neutral → dim.
  switch (tone) {
    case "good":
      return {
        color: theme.colors.complete.color,
        dim: theme.colors.complete.dim === true,
      };
    case "bad":
      return {
        color: theme.colors.danger.color,
        dim: theme.colors.danger.dim === true,
      };
    case "neutral":
    default:
      return {
        color: theme.colors.dim.color,
        dim: theme.colors.dim.dim === true,
      };
  }
}

function WorkflowListImpl({
  title,
  rows,
  footer,
  width,
  height,
}: WorkflowListProps): React.ReactElement {
  const theme = useTheme();
  const separator = theme.frame.h.repeat(Math.max(0, width));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text bold>{title}</Text>
      <Text
        color={theme.colors.dim.color}
        dimColor={theme.colors.dim.dim === true}
      >
        {separator}
      </Text>

      {rows.map((row) => {
        const toneSpec = toneColor(row.flagTone, theme);
        return (
          <Box key={row.id} flexDirection="row">
            <Text bold={row.isSelected}>{row.cursorGlyph}</Text>
            <Text bold={row.isSelected}>{row.sourceText}</Text>
            <Text>{row.badgeText}</Text>
            <Text color={toneSpec.color} dimColor={toneSpec.dim === true}>
              {row.flagText}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {footer}
        </Text>
      </Box>
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const WorkflowList = WorkflowListImpl;
