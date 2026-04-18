// src/components/runs-filter-bar.tsx
//
// Single-line `/`-bar for the runs table (P5-T2). Controlled input —
// the component owns no draft state of its own; it reads the draft from
// `runsFilter.draft` and emits reducer actions on each keystroke.
//
// Key routing:
//   Printable char  → RUNS_FILTER_INPUT(draft + ch)
//   Backspace       → RUNS_FILTER_INPUT(draft.slice(0,-1))
//   Ctrl-U          → RUNS_FILTER_INPUT("")
//   Enter           → RUNS_FILTER_APPLY
//   Esc (empty)     → RUNS_FILTER_CLOSE
//   Esc (non-empty) → RUNS_FILTER_CLEAR
//
// Authoritative references:
//   - docs/tui/plans/P5-T2.md §6 (filter bar UI).
//
// `inputDisabled` matches the P5-T1 `<RunsTable>` precedent — snapshot
// tests that don't want input routing set it, and a parent that routes
// keys itself suppresses the useInput hook here.

import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
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

const CTRL_U_CHAR = "\u0015";

function RunsFilterBarImpl({
  filter,
  dispatch,
  width,
  inputDisabled,
}: RunsFilterBarProps): React.ReactElement | null {
  const theme = useTheme();

  useInput(
    (input, key) => {
      if (!filter.open) return;

      if (key.return) {
        dispatch({ type: "RUNS_FILTER_APPLY" });
        return;
      }

      if (key.escape) {
        if (filter.draft.length === 0) {
          dispatch({ type: "RUNS_FILTER_CLOSE" });
        } else {
          dispatch({ type: "RUNS_FILTER_CLEAR" });
        }
        return;
      }

      if (key.backspace) {
        dispatch({
          type: "RUNS_FILTER_INPUT",
          value: filter.draft.slice(0, -1),
        });
        return;
      }

      // Ctrl-U → clear line but keep bar open.
      if (key.ctrl && input === "u") {
        dispatch({ type: "RUNS_FILTER_INPUT", value: "" });
        return;
      }

      // Some terminals deliver Ctrl-U as the raw NAK character.
      if (input === CTRL_U_CHAR) {
        dispatch({ type: "RUNS_FILTER_INPUT", value: "" });
        return;
      }

      if (input && !key.ctrl && !key.escape) {
        dispatch({
          type: "RUNS_FILTER_INPUT",
          value: filter.draft + input,
        });
      }
    },
    { isActive: !inputDisabled && filter.open },
  );

  if (!filter.open) return null;

  // Live local parse for annotation — does not touch state.
  const liveParse = parseFilterInput(filter.draft);

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        <Text
          color={theme.colors.accent.color}
          dimColor={theme.colors.accent.dim === true}
        >
          {"> "}
        </Text>
        <Text>{"/"}</Text>
        <Text>{filter.draft}</Text>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {"_"}
        </Text>
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

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const RunsFilterBar = RunsFilterBarImpl;
