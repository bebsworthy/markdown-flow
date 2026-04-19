import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { RunsTableRow } from "../runs/types.js";
import { formatElapsed } from "../runs/derive.js";

export interface RunPreviewProps {
  readonly row: RunsTableRow | null;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
}

function RunPreviewImpl({
  row,
  width,
  height,
  nowMs,
}: RunPreviewProps): React.ReactElement {
  const theme = useTheme();

  if (!row || width <= 0 || height <= 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          no run selected (\u2191\u2193 to pick a row)
        </Text>
      </Box>
    );
  }

  const info = row.info;
  const startMs = Date.parse(info.startedAt);
  const liveAge = Number.isFinite(startMs)
    ? formatElapsed(nowMs - startMs)
    : "\u2014";

  const lines: Array<{ label: string; value: string; role?: string }> = [
    { label: "Run", value: info.id },
    { label: "Workflow", value: info.workflowName },
    { label: "Status", value: row.statusLabel, role: row.statusCell.role },
    { label: "Started", value: info.startedAt },
    { label: "Age", value: liveAge },
  ];

  if (info.completedAt) {
    lines.push({ label: "Completed", value: info.completedAt });
    lines.push({ label: "Elapsed", value: row.elapsed });
  }

  if (info.steps.length > 0) {
    const last = info.steps[info.steps.length - 1]!;
    lines.push({ label: "Last step", value: last.node });
    lines.push({
      label: "Steps",
      value: `${info.steps.length} completed`,
    });
  }

  const note = row.note;
  if (note) {
    lines.push({ label: "Note", value: note });
  }

  const labelWidth = Math.max(...lines.map((l) => l.label.length));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {lines.slice(0, height).map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {`${line.label.padEnd(labelWidth)}  `}
          </Text>
          <Text
            color={
              line.role
                ? theme.colors[line.role as keyof typeof theme.colors]?.color
                : undefined
            }
            wrap="truncate-end"
          >
            {line.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export const RunPreview = React.memo(RunPreviewImpl);
RunPreview.displayName = "RunPreview";
