import React from "react";
import { Box } from "ink";
import { useTheme } from "../theme/context.js";

export interface SplitPaneProps {
  readonly children: [React.ReactNode, React.ReactNode];
  readonly direction?: "row" | "column";
  readonly ratio?: number;
  readonly gap?: number;
  readonly divider?: boolean;
  readonly dividerStyle?: string;
  readonly minFirst?: number;
  readonly minSecond?: number;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
}

export function SplitPane({
  children,
  direction = "column",
  ratio = 0.5,
  gap = 0,
  divider = false,
  dividerStyle,
  minFirst,
  minSecond,
  width = "100%",
  height = "100%",
  flexGrow,
  flexShrink,
}: SplitPaneProps): React.ReactElement {
  const theme = useTheme();
  const isColumn = direction === "column";
  const resolvedDividerStyle = (dividerStyle ??
    (theme.capabilities.unicode ? "double" : "classic")) as
    | "double"
    | "classic";

  const firstBasis = `${Math.round(ratio * 100)}%`;
  const secondBasis = `${Math.round((1 - ratio) * 100)}%`;

  return (
    <Box
      flexDirection={direction}
      width={width}
      height={height}
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      gap={divider ? 0 : gap}
    >
      <Box
        flexBasis={firstBasis}
        flexGrow={1}
        flexShrink={1}
        minHeight={isColumn ? minFirst : undefined}
        minWidth={!isColumn ? minFirst : undefined}
        overflow="hidden"
      >
        {children[0]}
      </Box>

      {divider && (
        <Box
          borderStyle={resolvedDividerStyle}
          borderTop={isColumn}
          borderLeft={!isColumn}
          borderBottom={false}
          borderRight={false}
          flexShrink={0}
        />
      )}

      <Box
        flexBasis={secondBasis}
        flexGrow={1}
        flexShrink={1}
        minHeight={isColumn ? minSecond : undefined}
        minWidth={!isColumn ? minSecond : undefined}
        overflow="hidden"
      >
        {children[1]}
      </Box>
    </Box>
  );
}
