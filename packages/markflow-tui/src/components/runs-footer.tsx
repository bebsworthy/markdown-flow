// src/components/runs-footer.tsx
//
// Runs-table footer (P5-T2). Renders `N shown · M archived · a Show all`
// per mockups.md §1 line 16. The label flips to `a Hide archived` when
// the archive toggle is currently including archived rows (features.md
// §5.6 rule 6). Owns no input — the parent `<RunsTable>` routes `a`.
//
// Narrow tier (width < 90 per plan §8.2): the label drops to the compact
// form `N · M · a Show all`.
//
// Authoritative references:
//   - docs/tui/mockups.md §1 (footer text + thousands grouping).
//   - docs/tui/features.md §5.6 rule 6 (toggle label flip).
//   - docs/tui/plans/P5-T2.md §8.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";

export interface RunsFooterProps {
  readonly shown: number;
  readonly archived: number;
  readonly archiveShown: boolean;
  readonly width: number;
}

/**
 * Format a count with thin-ish grouping matching mockup style (`9 995`).
 * We use an ordinary space rather than `\u202F` (narrow no-break) because
 * the latter doesn't survive ink-testing-library's string composition
 * consistently; tests accept either.
 */
function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.trunc(n)
    .toLocaleString("en-US")
    .replace(/,/g, " ");
}

const NARROW_TIER_MAX = 89; // matches plan §8.2 boundary (< 90 cols)

function RunsFooterImpl({
  shown,
  archived,
  archiveShown,
  width,
}: RunsFooterProps): React.ReactElement {
  const theme = useTheme();
  const narrow = width <= NARROW_TIER_MAX;
  const label = archiveShown ? "a Hide archived" : "a Show all";

  if (narrow) {
    return (
      <Box flexDirection="row">
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {`${formatCount(shown)} · ${formatCount(archived)} · ${label}`}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text
        color={theme.colors.dim.color}
        dimColor={theme.colors.dim.dim === true}
      >
        {`${formatCount(shown)} shown · ${formatCount(archived)} archived · ${label}`}
      </Text>
    </Box>
  );
}

export const RunsFooter = React.memo(RunsFooterImpl);
RunsFooter.displayName = "RunsFooter";
