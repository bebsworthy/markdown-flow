// src/components/command-palette-modal.tsx
//
// <CommandPaletteModal> — the `:` command palette overlay (P7-T3).
//
// References: docs/tui/mockups.md §10; docs/tui/features.md §3.10.

import React, { useMemo, useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import { Modal } from "../primitives/Modal.js";
import type { AppContext } from "./types.js";
import {
  COMMANDS,
  executeCommand,
  filterCommands,
  initialPaletteState,
  paletteReducer,
  parseInput,
} from "../palette/index.js";
import type {
  CommandExecContext,
  CommandMatch,
  PaletteAction,
  PaletteState,
} from "../palette/types.js";

export interface CommandPaletteModalProps {
  readonly query: string;
  readonly ctx: AppContext;
  readonly exec: CommandExecContext;
  readonly onQueryChange: (q: string) => void;
  readonly onClose: () => void;
  readonly visible: boolean;
  readonly width?: number | string;
  readonly maxHeight?: number | string;
}

function CommandPaletteModalImpl(
  props: CommandPaletteModalProps,
): React.ReactElement {
  const { query, ctx, exec, onQueryChange, onClose, visible, width, maxHeight } =
    props;
  const theme = useTheme();

  const parsed = parseInput(":" + query);
  const headQuery = parsed ? parsed.head : "";
  const arg = parsed ? parsed.arg : "";

  const matches = useMemo<readonly CommandMatch[]>(
    () => filterCommands(headQuery, COMMANDS, ctx),
    [headQuery, ctx],
  );

  const [state, dispatch] = useReducer(
    (s: PaletteState, a: PaletteAction) =>
      paletteReducer(s, a, { matchCount: matches.length }),
    initialPaletteState,
  );
  const stateRef = useRef<PaletteState>(state);
  stateRef.current = state;

  const matchesRef = useRef<readonly CommandMatch[]>(matches);
  matchesRef.current = matches;

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (stateRef.current.fsm === "running") return;

      if (key.upArrow) {
        dispatch({ type: "CURSOR_MOVE", delta: -1 });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: "CURSOR_MOVE", delta: 1 });
        return;
      }
      if (key.tab) {
        const m = matchesRef.current;
        if (m.length === 0) return;
        if (m.length === 1) {
          const only = m[0]!.command;
          const usage = only.argRequired ? `${only.name} ` : only.name;
          onQueryChange(usage);
          dispatch({ type: "CURSOR_RESET_TO_FIRST" });
          return;
        }
        const prefix = longestCommonPrefix(m.map((cm) => cm.command.name));
        if (prefix.length > headQuery.length) {
          onQueryChange(prefix);
          dispatch({ type: "CURSOR_RESET_TO_FIRST" });
        }
        return;
      }
      if (key.return) {
        const m = matchesRef.current;
        const pick = m[stateRef.current.cursor];
        if (!pick) return;
        dispatch({ type: "RUN_START" });
        void (async () => {
          try {
            const result = await executeCommand(pick, arg, exec);
            if (result.kind === "ok") {
              dispatch({ type: "RUN_OK" });
              exec.dispatch({ type: "OVERLAY_CLOSE" });
            } else {
              dispatch({ type: "RUN_FAIL", error: result.message });
            }
          } catch (err) {
            dispatch({
              type: "RUN_FAIL",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }
      if (key.backspace) {
        if (query.length === 0) return;
        onQueryChange(query.slice(0, -1));
        dispatch({ type: "CURSOR_RESET_TO_FIRST" });
        return;
      }
      if (input && input.length > 0 && !key.ctrl && !key.escape) {
        onQueryChange(query + input);
        dispatch({ type: "CURSOR_RESET_TO_FIRST" });
      }
    },
    { isActive: visible },
  );

  const inputLine = `:${query}\u2588`;

  return (
    <Modal visible={visible} title="COMMAND" width={width} maxHeight={maxHeight}>
      <Box flexDirection="column">
        <Text>{inputLine}</Text>
        <Box
          borderStyle={theme.capabilities.unicode ? "single" : "classic"}
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        />
        {matches.length === 0 ? (
          <Text dimColor>no commands match</Text>
        ) : (
          matches.map((m, idx) => {
            const selected = idx === state.cursor;
            return (
              <Box key={`c-${m.command.id}`}>
                <Text
                  bold={selected}
                  color={selected ? theme.colors.accent.color : undefined}
                >
                  {selected ? "\u25b6 " : "  "}
                  {m.command.name}
                  {"  "}
                  {m.command.summary}
                </Text>
              </Box>
            );
          })
        )}
        <Text> </Text>
        {state.fsm === "running" ? (
          <Text dimColor>Running\u2026</Text>
        ) : state.fsm === "error" && state.error ? (
          <Text
            color={theme.colors.danger.color}
            dimColor={theme.colors.danger.dim === true}
          >
            {state.error}
          </Text>
        ) : null}
      </Box>
    </Modal>
  );
}

function longestCommonPrefix(xs: readonly string[]): string {
  if (xs.length === 0) return "";
  let p = xs[0] ?? "";
  for (let i = 1; i < xs.length; i++) {
    const s = xs[i]!;
    let j = 0;
    while (j < p.length && j < s.length && p[j] === s[j]) j++;
    p = p.slice(0, j);
    if (p === "") return "";
  }
  return p;
}

export const CommandPaletteModal = CommandPaletteModalImpl;
