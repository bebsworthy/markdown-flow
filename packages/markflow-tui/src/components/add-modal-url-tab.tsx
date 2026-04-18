// src/components/add-modal-url-tab.tsx
//
// Pure rendering sub-component for the add-modal's URL tab. Owns no input
// handling — the parent `<AddWorkflowModal>` routes every key.
//
// Authoritative references:
//   - docs/tui/plans/P4-T3.md §5 (modal layout).

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";

export interface AddModalUrlTabProps {
  readonly url: string;
  readonly ingesting: boolean;
  readonly error: string | null;
  readonly width?: number | string;
}

function AddModalUrlTabImpl({
  url,
  ingesting,
  error,
  width,
}: AddModalUrlTabProps): React.ReactElement {
  const theme = useTheme();

  return (
    <Box flexDirection="column" width={width}>
      <Text>Enter a path, glob, or URL (http/https).</Text>
      <Text> </Text>
      <Box>
        <Text>path: </Text>
        <Text inverse>{url || " "}</Text>
      </Box>

      {ingesting ? (
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {"  Fetching\u2026"}
        </Text>
      ) : null}

      {error !== null ? (
        <Text
          color={theme.colors.danger.color}
          dimColor={theme.colors.danger.dim === true}
        >
          {`  ${error}`}
        </Text>
      ) : null}
    </Box>
  );
}

export const AddModalUrlTab = React.memo(AddModalUrlTabImpl);
AddModalUrlTab.displayName = "AddModalUrlTab";
