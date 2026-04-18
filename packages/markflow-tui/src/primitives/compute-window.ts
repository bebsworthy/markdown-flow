export interface WindowState {
  offset: number;
  visibleRows: number;
  cursor: number;
}

export function computeWindow(args: {
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
