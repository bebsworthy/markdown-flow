import React from "react";
import { Box, useInput } from "ink";
import { Panel } from "./Panel.js";

export interface ModalProps {
  readonly children: React.ReactNode;
  readonly visible: boolean;
  readonly title?: string;
  readonly width?: number | string;
  readonly maxWidth?: number | string;
  readonly minWidth?: number;
  readonly maxHeight?: number | string;
  readonly minHeight?: number;
  readonly onClose?: () => void;
  readonly borderColor?: string;
  readonly borderDimColor?: boolean;
}

export function Modal({
  children,
  visible,
  title,
  width,
  maxWidth = 90,
  minWidth = 30,
  maxHeight,
  minHeight = 5,
  onClose,
  borderColor,
  borderDimColor,
}: ModalProps): React.ReactElement | null {
  useInput(
    (_input, key) => {
      if (key.escape && onClose) {
        onClose();
      }
    },
    { isActive: visible && onClose != null },
  );

  if (!visible) return null;

  return (
    <Panel
      title={title}
      width={width}
      maxWidth={maxWidth}
      minWidth={minWidth}
      maxHeight={maxHeight}
      minHeight={minHeight}
      overflow="hidden"
      borderColor={borderColor}
      borderDimColor={borderDimColor}
    >
      {children}
    </Panel>
  );
}

export function ModalOverlay({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      {children}
    </Box>
  );
}
