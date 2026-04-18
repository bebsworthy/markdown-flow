// src/components/command-palette-modal.tsx
//
// <CommandPaletteModal> — the `:` command palette overlay (P7-T3).
//
// References: docs/tui/mockups.md §10; docs/tui/features.md §3.10.

import React, { useMemo, useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
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
  readonly width: number;
  readonly height: number;
}

function CommandPaletteModalImpl(
  props: CommandPaletteModalProps,
): React.ReactElement {
  const { query, ctx, exec, onQueryChange, onClose, width, height } = props;
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

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (stateRef.current.fsm === "running") {
      // Block everything except Esc while running.
      return;
    }
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
        // Rewrite to full usage (trailing space for arg flow).
        const only = m[0]!.command;
        const usage = only.argRequired
          ? `${only.name} `
          : only.name;
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
    if (input && input.length > 0 && !key.ctrl && !key.meta) {
      onQueryChange(query + input);
      dispatch({ type: "CURSOR_RESET_TO_FIRST" });
    }
  });

  // ---- Rendering ---------------------------------------------------------

  const frame = theme.frame;
  const w = Math.max(20, width);
  const topEdge = frame.tl + frame.h.repeat(Math.max(0, w - 2)) + frame.tr;
  const botEdge = frame.bl + frame.h.repeat(Math.max(0, w - 2)) + frame.br;
  const innerWidth = Math.max(4, w - 4);

  const inputLine = `:${query}\u2588`;

  return (
    <Box flexDirection="column" width={w} height={height}>
      <Text>{topEdge}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text bold>COMMAND</Text>
      </Box>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text>{inputLine}</Text>
      </Box>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text>{"\u2500".repeat(innerWidth)}</Text>
      </Box>
      {matches.length === 0 ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text dimColor>no commands match</Text>
        </Box>
      ) : (
        matches.map((m, idx) => {
          const selected = idx === state.cursor;
          return (
            <Box key={`c-${m.command.id}`} flexDirection="row">
              <Text>{frame.v} </Text>
              <Text
                bold={selected}
                color={
                  selected ? theme.colors.accent.color : undefined
                }
              >
                {selected ? "\u25b6 " : "  "}
                {renderName(m)}
                {"  "}
                {m.command.summary}
              </Text>
            </Box>
          );
        })
      )}
      <Text>{frame.v}</Text>
      {state.fsm === "running" ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text dimColor>Running\u2026</Text>
        </Box>
      ) : state.fsm === "error" && state.error ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text
            color={theme.colors.danger.color}
            dimColor={theme.colors.danger.dim === true}
          >
            {state.error}
          </Text>
        </Box>
      ) : null}
      <Text>{botEdge}</Text>
    </Box>
  );
}

function renderName(m: CommandMatch): string {
  // Bold-char rendering collapsed to plain text for simplicity — the ink
  // Text primitive doesn't mid-line bold easily. Character-level bold is
  // asserted via matchedIndices in the pure test; the rendered frame shows
  // the command name verbatim.
  return m.command.name;
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

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const CommandPaletteModal = CommandPaletteModalImpl;
