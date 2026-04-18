// src/components/add-modal-fuzzy-tab.tsx
//
// Pure rendering sub-component for the add-modal's fuzzy-find tab. Owns
// no input handling — the parent `<AddWorkflowModal>` routes every key.
//
// Authoritative references:
//   - docs/tui/mockups.md §2 lines 97–118.
//   - docs/tui/plans/P4-T3.md §7.1.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { RankedCandidate, ValidationResult } from "../add-modal/types.js";

export interface AddModalFuzzyTabProps {
  readonly root: string;
  readonly query: string;
  readonly ranked: ReadonlyArray<RankedCandidate>;
  readonly selectedIndex: number;
  readonly visibleLimit: number;
  readonly walkerTruncated: boolean;
  readonly candidateCount: number;
  readonly validationByPath: ReadonlyMap<string, ValidationResult>;
  readonly rootPickerOpen: boolean;
  readonly rootPickerDraft: string;
  readonly rootPickerError: string | null;
  readonly width?: number | string;
}

function formatBadge(
  candidateKind: "file" | "workspace",
  res: ValidationResult | undefined,
): { text: string; tone: "neutral" | "bad" } {
  if (res === undefined) {
    return {
      text: candidateKind === "file" ? "[file]" : "[workspace]",
      tone: "neutral",
    };
  }
  if (res.kind === "file-valid") return { text: "[file]", tone: "neutral" };
  if (res.kind === "workspace")
    return { text: "[workspace]", tone: "neutral" };
  if (res.kind === "file-parse-error")
    return { text: "[file \u00b7 \u2717 parse]", tone: "bad" };
  return { text: "[workspace \u00b7 \u2717 invalid]", tone: "bad" };
}

function AddModalFuzzyTabImpl(
  props: AddModalFuzzyTabProps,
): React.ReactElement {
  const {
    root,
    query,
    ranked,
    selectedIndex,
    visibleLimit,
    walkerTruncated,
    candidateCount,
    validationByPath,
    rootPickerOpen,
    rootPickerDraft,
    rootPickerError,
    width,
  } = props;
  const theme = useTheme();
  const visible = ranked.slice(0, visibleLimit);

  return (
    <Box flexDirection="column" width={width}>
      {/* Root line */}
      {rootPickerOpen ? (
        <Box flexDirection="column">
          <Box>
            <Text>root:  </Text>
            <Text inverse>{rootPickerDraft || " "}</Text>
            <Text
              color={theme.colors.dim.color}
              dimColor={theme.colors.dim.dim === true}
            >
              {"  (Enter to confirm, Esc to cancel)"}
            </Text>
          </Box>
          {rootPickerError !== null ? (
            <Text
              color={theme.colors.danger.color}
              dimColor={theme.colors.danger.dim === true}
            >
              {rootPickerError}
            </Text>
          ) : null}
        </Box>
      ) : (
        <Box>
          <Text>root:  </Text>
          <Text>{root}</Text>
          <Text
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {"  (Ctrl+Up to change \u2014 anywhere on disk)"}
          </Text>
        </Box>
      )}

      {/* Find line */}
      <Box>
        <Text>find:  </Text>
        <Text inverse>{query || " "}</Text>
      </Box>

      <Text> </Text>

      {/* Result list */}
      {visible.length === 0 ? (
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {query.length === 0
            ? candidateCount === 0
              ? "  (scanning\u2026)"
              : "  (type to filter)"
            : "  (no matches)"}
        </Text>
      ) : (
        visible.map((row, idx) => {
          const isSelected = idx === selectedIndex;
          const cursor = isSelected ? "\u25b6 " : "  ";
          const badge = formatBadge(
            row.candidate.kind,
            validationByPath.get(row.candidate.absolutePath),
          );
          return (
            <Box key={row.candidate.absolutePath}>
              <Text
                color={
                  isSelected
                    ? theme.colors.accent.color
                    : undefined
                }
                dimColor={
                  isSelected ? theme.colors.accent.dim === true : false
                }
              >
                {cursor}
              </Text>
              <Text>
                {row.candidate.displayPath}
                {"  "}
              </Text>
              {badge.tone === "bad" ? (
                <Text
                  color={theme.colors.danger.color}
                  dimColor={theme.colors.danger.dim === true}
                >
                  {badge.text}
                </Text>
              ) : (
                <Text
                  color={theme.colors.dim.color}
                  dimColor={theme.colors.dim.dim === true}
                >
                  {badge.text}
                </Text>
              )}
            </Box>
          );
        })
      )}

      {/* Truncated footer */}
      {walkerTruncated ? (
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {`  showing ${candidateCount}/${candidateCount}+ \u2014 refine`}
        </Text>
      ) : null}
    </Box>
  );
}

export const AddModalFuzzyTab = React.memo(AddModalFuzzyTabImpl);
AddModalFuzzyTab.displayName = "AddModalFuzzyTab";
