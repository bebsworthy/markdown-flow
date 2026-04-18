import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { computeWindow } from "./compute-window.js";

export interface ColumnDef<T> {
  readonly id: string;
  readonly header: string;
  readonly width?: number;
  readonly grow?: boolean;
  readonly align?: "left" | "right";
  readonly render: (row: T) => string;
  readonly renderCell?: (row: T, width: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  readonly columns: ReadonlyArray<ColumnDef<T>>;
  readonly rows: ReadonlyArray<T>;
  readonly rowKey: (row: T) => string;
  readonly cursorIndex?: number;
  readonly width?: number;
  readonly height?: number;
  readonly cursorGutter?: number;
  readonly columnGap?: number;
  readonly showHeader?: boolean;
  readonly cursorGlyph?: string;
  readonly emptyState?: React.ReactNode;
  readonly headerDimColor?: boolean;
}

function DataTableRow<T>({
  row,
  columns,
  isCursor,
  cursorGutter,
  cursorGlyph,
  columnGap,
}: {
  row: T;
  columns: ReadonlyArray<ColumnDef<T>>;
  isCursor: boolean;
  cursorGutter: number;
  cursorGlyph: string;
  columnGap: number;
}): React.ReactElement {
  return (
    <Box flexDirection="row" columnGap={columnGap}>
      <Box width={cursorGutter} flexShrink={0}>
        <Text bold={isCursor}>{isCursor ? cursorGlyph : " "}</Text>
      </Box>
      {columns.map((col) => {
        const boxProps = col.grow
          ? { flexGrow: 1, flexShrink: 1 }
          : { width: col.width ?? 10, flexShrink: 0, flexGrow: 0 };

        return (
          <Box
            key={col.id}
            {...boxProps}
            justifyContent={
              col.align === "right" ? "flex-end" : "flex-start"
            }
          >
            {col.renderCell ? (
              col.renderCell(row, col.width ?? 0)
            ) : (
              <Text wrap="truncate-end">{col.render(row)}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  cursorIndex = -1,
  width,
  height,
  cursorGutter = 2,
  columnGap = 1,
  showHeader = true,
  cursorGlyph = "›",
  emptyState,
  headerDimColor = true,
}: DataTableProps<T>): React.ReactElement {
  const headerRows = showHeader ? 1 : 0;
  const dataHeight = height != null ? Math.max(0, height - headerRows) : undefined;

  const [offset, setOffset] = useState(0);

  const window = dataHeight != null
    ? computeWindow({
        rowCount: rows.length,
        cursor: Math.max(0, cursorIndex),
        offset,
        visibleRows: dataHeight,
      })
    : null;

  useEffect(() => {
    if (window) setOffset(window.offset);
  }, [window?.offset]);

  const visibleRows = window
    ? rows.slice(window.offset, window.offset + window.visibleRows)
    : rows;
  const startIndex = window?.offset ?? 0;

  if (rows.length === 0 && emptyState) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        overflow="hidden"
      >
        {emptyState}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      overflow="hidden"
    >
      {showHeader && (
        <Box flexDirection="row" columnGap={columnGap} flexShrink={0}>
          <Box width={cursorGutter} flexShrink={0}>
            <Text> </Text>
          </Box>
          {columns.map((col) => {
            const boxProps = col.grow
              ? { flexGrow: 1, flexShrink: 1 }
              : { width: col.width ?? 10, flexShrink: 0, flexGrow: 0 };

            return (
              <Box
                key={col.id}
                {...boxProps}
                justifyContent={
                  col.align === "right" ? "flex-end" : "flex-start"
                }
              >
                <Text
                  dimColor={headerDimColor}
                  bold
                  wrap="truncate-end"
                >
                  {col.header}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map((row, i) => {
          const realIndex = startIndex + i;
          return (
            <DataTableRow
              key={rowKey(row)}
              row={row}
              columns={columns}
              isCursor={realIndex === cursorIndex}
              cursorGutter={cursorGutter}
              cursorGlyph={cursorGlyph}
              columnGap={columnGap}
            />
          );
        })}
      </Box>
    </Box>
  );
}
