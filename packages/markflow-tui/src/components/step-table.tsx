// src/components/step-table.tsx
//
// Stateless READ-ONLY step-table pane. Composes a `<DataTable>` with
// column-set selection, themed status cells, aggregate progress bars,
// and depth-indented step labels. Does NOT own `useInput` — cursor
// navigation lands in P6-T2.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §9
//   - docs/tui/mockups.md §4 (running) + §6 (terminal)

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import {
  DEFAULT_PROGRESS_BAR_WIDTH,
  formatProgressBar,
} from "../steps/aggregate.js";
import type { StepRow, StepTableColumn } from "../steps/types.js";
import { DataTable, type ColumnDef } from "../primitives/DataTable.js";

export interface StepTableProps {
  readonly rows: ReadonlyArray<StepRow>;
  readonly columns: ReadonlyArray<StepTableColumn>;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly selectedStepId?: string | null;
  readonly cursorRowIndex?: number;
}

const DEFAULT_CURSOR_INDEX = -1;

function toDataTableColumns(
  columns: ReadonlyArray<StepTableColumn>,
  theme: ReturnType<typeof useTheme>,
): ReadonlyArray<ColumnDef<StepRow>> {
  return columns.map((col) => {
    const base = {
      id: col.id,
      header: col.header,
      width: col.width,
      grow: col.grow,
      align: col.align,
      render: (row: StepRow) => col.projectText(row, new Map()),
    };

    if (col.id === "status" && col.projectStatus) {
      const projectStatus = col.projectStatus;
      return {
        ...base,
        renderCell: (row: StepRow) => {
          const cell = projectStatus(row);
          const themeGlyph = theme.glyphs[cell.glyphKey];
          const spec = theme.colors[cell.role];
          return (
            <Text
              color={spec.color}
              dimColor={spec.dim === true}
              wrap="truncate-end"
            >
              {themeGlyph} {cell.label}
            </Text>
          );
        },
      };
    }

    if (col.id === "note") {
      return {
        ...base,
        renderCell: (row: StepRow) => {
          if (row.kind === "batch-aggregate" && row.aggregate) {
            const bar = formatProgressBar(
              row.aggregate.completed,
              row.aggregate.expected,
              DEFAULT_PROGRESS_BAR_WIDTH,
              theme.glyphs.progressFilled,
              theme.glyphs.progressEmpty,
            );
            const count = `${row.aggregate.completed} / ${row.aggregate.expected}`;
            let suffix: string;
            if (row.aggregate.status === "running") {
              const word =
                row.aggregate.retries === 1 ? "retry" : "retries";
              suffix = `${row.aggregate.retries} ${word} \u00b7 ${row.aggregate.failed} failed`;
            } else if (row.aggregate.status === "failed") {
              suffix = `${row.aggregate.failed} ${theme.glyphs.fail} \u00b7 0 ${theme.glyphs.waiting}`;
            } else {
              suffix = "";
            }
            const composite =
              suffix.length === 0
                ? `${count}   ${bar}`
                : `${count}   ${bar}   ${suffix}`;
            return <Text wrap="truncate-end">{composite}</Text>;
          }
          return <Text wrap="truncate-end">{row.note}</Text>;
        },
      };
    }

    if (col.id === "step") {
      return {
        ...base,
        renderCell: (row: StepRow) => {
          if (row.kind === "batch-aggregate") {
            const indent = "  ".repeat(Math.max(0, row.depth));
            const label = `${theme.glyphs.batch} batch [${row.nodeId}]`;
            return <Text wrap="truncate-end">{indent}{label}</Text>;
          }
          const indent = "  ".repeat(Math.max(0, row.depth));
          return <Text wrap="truncate-end">{indent}{row.label}</Text>;
        },
      };
    }

    return base;
  });
}

function StepTableImpl({
  rows,
  columns,
  width,
  height,
  nowMs,
  selectedStepId,
  cursorRowIndex,
}: StepTableProps): React.ReactElement {
  void nowMs;
  void selectedStepId; // cursor now drives highlighting via DataTable
  const theme = useTheme();
  const cursor = cursorRowIndex ?? DEFAULT_CURSOR_INDEX;

  if (width <= 0 || height <= 0) return <Box width={width} height={height} />;

  const dtColumns = useMemo(
    () => toDataTableColumns(columns, theme),
    [columns, theme],
  );

  const emptyNode = (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={theme.colors.dim.color}
        dimColor={theme.colors.dim.dim === true}
      >
        no steps yet
      </Text>
    </Box>
  );

  return (
    <DataTable<StepRow>
      columns={dtColumns}
      rows={rows}
      rowKey={(r) => r.id}
      cursorIndex={cursor}
      width={width}
      height={height}
      cursorGlyph="▶"
      emptyState={emptyNode}
    />
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const StepTable = StepTableImpl;
