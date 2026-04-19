import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import { DataTable, type ColumnDef } from "../primitives/DataTable.js";
import {
  formatSourceBadge,
  formatStatusFlag,
  type StatusFlag,
} from "../browser/preview-layout.js";
import { pickBadgeColumnWidth } from "../browser/list-layout.js";
import type { ResolvedEntry } from "../browser/types.js";

export interface WorkflowListProps {
  readonly title: string;
  readonly entries: ReadonlyArray<ResolvedEntry>;
  readonly selectedIndex: number;
  readonly footer: string;
  readonly width: number;
  readonly height: number;
  readonly now?: number;
}

function toneColor(
  tone: StatusFlag["tone"],
  theme: ReturnType<typeof useTheme>,
): { color?: string; dim?: boolean } {
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

const MIN_FLAG_WIDTH = 7;

function WorkflowListImpl({
  title,
  entries,
  selectedIndex,
  footer,
  width,
  height,
  now,
}: WorkflowListProps): React.ReactElement {
  const theme = useTheme();
  const separator = theme.frame.h.repeat(Math.max(0, width));

  const badgeCol = useMemo(() => pickBadgeColumnWidth(entries), [entries]);

  const columns = useMemo<ReadonlyArray<ColumnDef<ResolvedEntry>>>(
    () => [
      {
        id: "title",
        header: "TITLE",
        grow: true,
        render: (e: ResolvedEntry) => e.title,
      },
      {
        id: "badge",
        header: "TYPE",
        width: badgeCol,
        render: (e: ResolvedEntry) => formatSourceBadge(e),
      },
      {
        id: "flag",
        header: "STATUS",
        width: MIN_FLAG_WIDTH,
        renderCell: (e: ResolvedEntry) => {
          const flag = formatStatusFlag(e, now);
          const tc = toneColor(flag.tone, theme);
          return (
            <Text
              color={tc.color}
              dimColor={tc.dim === true}
              wrap="truncate-end"
            >
              {flag.text}
            </Text>
          );
        },
        render: (e: ResolvedEntry) => formatStatusFlag(e, now).text,
      },
    ],
    [badgeCol, now, theme],
  );

  // title + separator + footer marginTop + footer text
  const chromeRows = 4;
  const dataHeight = Math.max(1, height - chromeRows);

  return (
    <Box flexDirection="column" height={height}>
      <Text bold>{title}</Text>
      <Text
        color={theme.colors.dim.color}
        dimColor={theme.colors.dim.dim === true}
      >
        {separator}
      </Text>

      <DataTable<ResolvedEntry>
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        cursorIndex={selectedIndex}
        showHeader={false}
        cursorGlyph="▶"
        cursorGutter={2}
        height={dataHeight}
      />

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

export const WorkflowList = WorkflowListImpl;
