import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface ScrollViewProps<T> {
  readonly items: ReadonlyArray<T>;
  readonly renderItem: (item: T, index: number) => React.ReactNode;
  readonly keyExtractor: (item: T, index: number) => string;
  readonly cursorIndex: number;
  readonly height: number;
  readonly width?: number | string;
  readonly headerRows?: number;
  readonly footerRows?: number;
  readonly scrollIndicator?: boolean;
}

interface WindowState {
  offset: number;
  visibleRows: number;
  cursor: number;
}

function computeWindow(args: {
  rowCount: number;
  cursor: number;
  offset: number;
  visibleRows: number;
}): WindowState {
  const visibleRows = Math.max(0, args.visibleRows);
  if (args.rowCount <= 0 || visibleRows <= 0) {
    return { offset: 0, visibleRows, cursor: 0 };
  }
  const clampedCursor = Math.max(0, Math.min(args.rowCount - 1, args.cursor));
  let offset = args.offset;
  const maxOffset = Math.max(0, args.rowCount - visibleRows);
  offset = Math.max(0, Math.min(offset, maxOffset));
  if (clampedCursor < offset) offset = clampedCursor;
  if (clampedCursor >= offset + visibleRows) {
    offset = clampedCursor - visibleRows + 1;
  }
  return { offset, visibleRows, cursor: clampedCursor };
}

export function ScrollView<T>({
  items,
  renderItem,
  keyExtractor,
  cursorIndex,
  height,
  width,
  headerRows = 0,
  footerRows = 0,
  scrollIndicator = false,
}: ScrollViewProps<T>): React.ReactElement {
  const dataRows = Math.max(0, height - headerRows - footerRows);

  const [offset, setOffset] = useState(0);

  const window = computeWindow({
    rowCount: items.length,
    cursor: cursorIndex,
    offset,
    visibleRows: dataRows,
  });

  useEffect(() => {
    setOffset(window.offset);
  }, [window.offset]);

  const visibleSlice = items.slice(
    window.offset,
    window.offset + window.visibleRows,
  );

  const hasMore = items.length > dataRows;
  const atTop = window.offset === 0;
  const atBottom = window.offset + window.visibleRows >= items.length;

  return (
    <Box
      flexDirection="column"
      height={height}
      width={width}
      overflow="hidden"
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {visibleSlice.map((item, i) => {
          const realIndex = window.offset + i;
          return (
            <Box key={keyExtractor(item, realIndex)} flexShrink={0}>
              {renderItem(item, realIndex)}
            </Box>
          );
        })}
      </Box>

      {scrollIndicator && hasMore && (
        <Box justifyContent="flex-end" flexShrink={0}>
          <Text dimColor>
            {atTop ? " ↓" : atBottom ? "↑ " : "↑↓"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
