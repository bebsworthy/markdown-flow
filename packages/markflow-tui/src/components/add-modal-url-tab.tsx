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
  readonly width: number;
}

function AddModalUrlTabImpl({
  url,
  ingesting,
  error,
  width,
}: AddModalUrlTabProps): React.ReactElement {
  const theme = useTheme();
  const prefixValid =
    url.length === 0 || /^https?:\/\//i.test(url);

  return (
    <Box flexDirection="column" width={width}>
      <Text>Paste a workflow URL (http or https).</Text>
      <Text> </Text>
      <Box>
        <Text>url:  </Text>
        <Text inverse>{url || " "}</Text>
      </Box>

      {!prefixValid ? (
        <Text
          color={theme.colors.danger.color}
          dimColor={theme.colors.danger.dim === true}
        >
          {"  expected http:// or https://"}
        </Text>
      ) : null}

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
