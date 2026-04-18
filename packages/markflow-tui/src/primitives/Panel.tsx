import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";

export interface PanelProps {
  readonly children: React.ReactNode;
  readonly title?: React.ReactNode;
  readonly titleAlign?: "left" | "center" | "right";
  readonly width?: number | string;
  readonly height?: number | string;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number | string;
  readonly maxHeight?: number | string;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexBasis?: number | string;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly overflow?: "visible" | "hidden";
  readonly borderColor?: string;
  readonly borderDimColor?: boolean;
  readonly display?: "flex" | "none";
}

export function Panel({
  children,
  title,
  titleAlign = "left",
  width,
  height,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  flexGrow,
  flexShrink,
  flexBasis,
  paddingX = 1,
  paddingY = 0,
  overflow = "hidden",
  borderColor,
  borderDimColor,
  display,
}: PanelProps): React.ReactElement {
  const theme = useTheme();
  const borderStyle = theme.capabilities.unicode ? "double" : "classic";

  const titleJustify =
    titleAlign === "center"
      ? "center"
      : titleAlign === "right"
        ? "flex-end"
        : "flex-start";

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={borderColor}
      borderDimColor={borderDimColor}
      paddingX={paddingX}
      paddingY={paddingY}
      overflow={overflow}
      flexDirection="column"
      width={width}
      height={height}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      flexBasis={flexBasis}
      {...(display != null ? { display } : {})}
    >
      {title != null && (
        <Box justifyContent={titleJustify}>
          {typeof title === "string" ? (
            <Text bold wrap="truncate-end">
              {title}
            </Text>
          ) : (
            title
          )}
        </Box>
      )}
      {children}
    </Box>
  );
}
