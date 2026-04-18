// src/components/help-overlay.tsx
//
// <HelpOverlay> — the `?` context-sensitive help overlay (P7-T3).
//
// References: docs/tui/mockups.md §11; docs/tui/features.md §3.10 / §5.6.

import React, { useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import type { AppContext, Binding } from "./types.js";
import { formatKeys } from "./keybar-layout.js";
import {
  deriveHelpModel,
  helpReducer,
  initialHelpState,
} from "../help/index.js";
import type { HelpAction, HelpLocalState } from "../help/index.js";

export interface HelpOverlayProps {
  readonly ctx: AppContext;
  readonly bindings: readonly Binding[];
  readonly modeLabel: string;
  readonly focusLabel: string;
  readonly onClose: () => void;
  readonly width: number;
  readonly height: number;
}

function HelpOverlayImpl(props: HelpOverlayProps): React.ReactElement {
  const {
    ctx,
    bindings,
    modeLabel,
    focusLabel,
    onClose,
    width,
    height,
  } = props;
  const theme = useTheme();

  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  // Forward ref for rowCount so the reducer closure reads the current value.
  const rowCountRef = useRef<number>(0);

  const [state, dispatch] = useReducer(
    (s: HelpLocalState, a: HelpAction) =>
      helpReducer(s, a, { rowCount: rowCountRef.current }),
    initialHelpState,
  );

  const model = useMemo(
    () => deriveHelpModel({ bindings, ctx, search: state.search }),
    [bindings, ctx, state.search],
  );

  rowCountRef.current = model.totalRows;

  const stateRef = useRef<HelpLocalState>(state);
  stateRef.current = state;
  const searchOpenRef = useRef<boolean>(searchOpen);
  searchOpenRef.current = searchOpen;

  useInput((input, key) => {
    if (key.escape) {
      if (searchOpenRef.current) {
        setSearchOpen(false);
        return;
      }
      onClose();
      return;
    }
    if (searchOpenRef.current) {
      if (key.return) {
        setSearchOpen(false);
        return;
      }
      if (key.backspace || key.delete) {
        const cur = stateRef.current.search;
        if (cur.length === 0) return;
        dispatch({ type: "SEARCH_SET", value: cur.slice(0, -1) });
        return;
      }
      if (input && input.length > 0 && !key.ctrl && !key.meta) {
        dispatch({
          type: "SEARCH_SET",
          value: stateRef.current.search + input,
        });
      }
      return;
    }
    if (input === "?") {
      onClose();
      return;
    }
    if (input === "/") {
      setSearchOpen(true);
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
  });

  // ---- Rendering ---------------------------------------------------------

  const frame = theme.frame;
  const w = Math.max(20, width);
  const topEdge = frame.tl + frame.h.repeat(Math.max(0, w - 2)) + frame.tr;
  const botEdge = frame.bl + frame.h.repeat(Math.max(0, w - 2)) + frame.br;

  const title =
    focusLabel.length > 0
      ? `HELP \u00b7 mode: ${modeLabel} \u00b7 focus: ${focusLabel}`
      : `HELP \u00b7 mode: ${modeLabel}`;

  const searchLine = searchOpen
    ? `/${state.search}\u2588`
    : state.search.length > 0
      ? `/${state.search}`
      : "/search";

  // Flat row ordering for cursor tracking.
  let flatIdx = 0;

  return (
    <Box flexDirection="column" width={w} height={height}>
      <Text>{topEdge}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text bold>{title}</Text>
        <Text> </Text>
        <Text dimColor>{searchLine}</Text>
      </Box>
      <Text>{frame.v}</Text>
      {model.sections.length === 0 ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text dimColor>no bindings match</Text>
        </Box>
      ) : (
        model.sections.map((sec) => (
          <Box key={`s-${sec.category}`} flexDirection="column">
            <Box flexDirection="row">
              <Text>{frame.v} </Text>
              <Text bold dimColor>
                {sec.category}
              </Text>
            </Box>
            {sec.rows.map((row) => {
              const rowIdx = flatIdx++;
              const selected = rowIdx === state.cursor;
              const keysText = formatKeys(row.keys);
              const body = row.annotation
                ? `${keysText}  ${row.label}  ${row.annotation}`
                : `${keysText}  ${row.label}`;
              return (
                <Box key={`r-${sec.category}-${rowIdx}`} flexDirection="row">
                  <Text>{frame.v}   </Text>
                  {selected ? (
                    <Text
                      bold
                      color={theme.colors.accent.color}
                      dimColor={theme.colors.accent.dim === true}
                    >
                      {body}
                    </Text>
                  ) : (
                    <Text>{body}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ))
      )}
      <Text>{frame.v}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text dimColor>{`${model.totalRows} bindings`}</Text>
      </Box>
      <Text>{botEdge}</Text>
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const HelpOverlay = HelpOverlayImpl;
