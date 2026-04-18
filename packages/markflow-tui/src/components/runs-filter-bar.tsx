// src/components/runs-filter-bar.tsx
//
// Single-line `/`-bar for the runs table (P5-T2). Controlled input —
// the component owns no draft state of its own; it reads the draft from
// `runsFilter.draft` and emits reducer actions on each keystroke.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import { TextInput } from "../primitives/TextInput.js";
import { parseFilterInput } from "../runs/filter.js";
import type { RunsFilterState } from "../runs/types.js";
import type { Action } from "../state/types.js";

export interface RunsFilterBarProps {
  readonly filter: RunsFilterState;
  readonly dispatch: (action: Action) => void;
  readonly width: number;
  /** Suppress all key handling (tests / sibling routers). */
  readonly inputDisabled?: boolean;
}

function RunsFilterBarImpl({
  filter,
  dispatch,
  width,
  inputDisabled,
}: RunsFilterBarProps): React.ReactElement | null {
  const theme = useTheme();

  if (!filter.open) return null;

  const liveParse = parseFilterInput(filter.draft);

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        <TextInput
          value={filter.draft}
          onChange={(v) => dispatch({ type: "RUNS_FILTER_INPUT", value: v })}
          onSubmit={() => dispatch({ type: "RUNS_FILTER_APPLY" })}
          onCancel={() => {
            if (filter.draft.length === 0) {
              dispatch({ type: "RUNS_FILTER_CLOSE" });
            } else {
              dispatch({ type: "RUNS_FILTER_CLEAR" });
            }
          }}
          prompt="> /"
          promptColor={theme.colors.accent.color}
          isActive={!inputDisabled && filter.open}
        />
      </Box>
      {liveParse.terms.length > 0 ? (
        <Box flexDirection="row">
          <Text>{"  "}</Text>
          {liveParse.terms.map((term, idx) => {
            const key = `${idx}-${term.kind}`;
            if (term.kind === "malformed") {
              return (
                <React.Fragment key={key}>
                  <Text
                    color={theme.colors.failed.color}
                    dimColor={theme.colors.failed.dim === true}
                  >
                    {`[${term.raw}]`}
                  </Text>
                  <Text> </Text>
                </React.Fragment>
              );
            }
            const label =
              term.kind === "status"
                ? `status:${term.value}`
                : term.kind === "workflow"
                  ? `workflow:${term.value}`
                  : term.kind === "since"
                    ? `since:${term.durationMs}ms`
                    : `id:${term.value}`;
            return (
              <React.Fragment key={key}>
                <Text
                  color={theme.colors.dim.color}
                  dimColor={theme.colors.dim.dim === true}
                >
                  {label}
                </Text>
                <Text> </Text>
              </React.Fragment>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

export const RunsFilterBar = RunsFilterBarImpl;
