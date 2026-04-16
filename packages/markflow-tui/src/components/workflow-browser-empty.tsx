// src/components/workflow-browser-empty.tsx
//
// Empty-state panel shown when the registry has no entries. Centered text
// lines per mockups.md §2 lines 82–91.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";

export interface WorkflowBrowserEmptyProps {
  /** Whether the registry is persisted. When false, the last line is swapped. */
  readonly persist: boolean;
  /** Width of the panel (for text centering). Defaults to 80. */
  readonly width?: number;
}

const DEFAULT_WIDTH = 80;

function WorkflowBrowserEmptyImpl({
  persist,
  width,
}: WorkflowBrowserEmptyProps): React.ReactElement {
  const theme = useTheme();
  const w = width ?? DEFAULT_WIDTH;

  const lastLine = persist
    ? "The list will be saved to ./.markflow-tui.json"
    : "Workflows saved: off (--no-save)";

  const lines: ReadonlyArray<string> = [
    "No workflows registered yet.",
    "",
    "Press  a  to add by fuzzy-find or path/URL",
    "or relaunch:   markflow-tui <path|glob|url>",
    "",
    lastLine,
  ];

  return (
    <Box flexDirection="column" width={w}>
      {lines.map((line, idx) => (
        <Box key={idx} width={w} justifyContent="center">
          <Text
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export const WorkflowBrowserEmpty = React.memo(WorkflowBrowserEmptyImpl);
WorkflowBrowserEmpty.displayName = "WorkflowBrowserEmpty";
