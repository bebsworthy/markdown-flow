import React from "react";
import { Box, Text, type TextProps } from "ink";

type WrapMode = "truncate-end" | "truncate-start" | "truncate-middle";

export interface CellProps {
  readonly children: string;
  readonly width: number;
  readonly align?: "left" | "right";
  readonly truncate?: "end" | "start" | "middle";
  readonly color?: TextProps["color"];
  readonly backgroundColor?: TextProps["backgroundColor"];
  readonly bold?: boolean;
  readonly dimColor?: boolean;
  readonly inverse?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
}

const WRAP_MAP: Record<NonNullable<CellProps["truncate"]>, WrapMode> = {
  end: "truncate-end",
  start: "truncate-start",
  middle: "truncate-middle",
};

export function Cell({
  children,
  width,
  align = "left",
  truncate = "end",
  ...textProps
}: CellProps): React.ReactElement {
  return (
    <Box
      width={width}
      flexShrink={0}
      flexGrow={0}
      justifyContent={align === "right" ? "flex-end" : "flex-start"}
    >
      <Text wrap={WRAP_MAP[truncate]} {...textProps}>
        {children}
      </Text>
    </Box>
  );
}
