import React from "react";
import { Box, Text, useInput } from "ink";

export interface TextInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly onCancel?: () => void;
  readonly prompt?: string;
  readonly placeholder?: string;
  readonly isActive?: boolean;
  readonly ctrlUClears?: boolean;
  readonly cursorChar?: string;
  readonly showCursor?: boolean;
  readonly promptColor?: string;
  readonly placeholderDimColor?: boolean;
}

const CTRL_U_CHAR = "\u0015";

export function TextInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  prompt,
  placeholder,
  isActive = true,
  ctrlUClears = true,
  cursorChar = "\u2588",
  showCursor = true,
  promptColor,
  placeholderDimColor = true,
}: TextInputProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (key.return && onSubmit) {
        onSubmit(value);
        return;
      }

      if (key.escape && onCancel) {
        onCancel();
        return;
      }

      if (key.backspace) {
        onChange(value.slice(0, -1));
        return;
      }

      if (ctrlUClears && ((key.ctrl && input === "u") || input === CTRL_U_CHAR)) {
        onChange("");
        return;
      }

      if (input && !key.ctrl && !key.meta && !key.escape) {
        onChange(value + input);
      }
    },
    { isActive },
  );

  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box flexDirection="row" flexGrow={1}>
      {prompt != null && (
        <Box flexShrink={0}>
          <Text color={promptColor}>{prompt}</Text>
        </Box>
      )}
      <Box flexGrow={1} flexShrink={1}>
        {showPlaceholder ? (
          <Text dimColor={placeholderDimColor} wrap="truncate-end">
            {placeholder}
          </Text>
        ) : (
          <Text wrap="truncate-start">{value}</Text>
        )}
      </Box>
      {showCursor && (
        <Box flexShrink={0}>
          <Text inverse>{cursorChar}</Text>
        </Box>
      )}
    </Box>
  );
}
