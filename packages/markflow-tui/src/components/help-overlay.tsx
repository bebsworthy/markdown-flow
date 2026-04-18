// src/components/help-overlay.tsx
//
// <HelpOverlay> — the `?` context-sensitive help overlay (P7-T3).
//
// References: docs/tui/mockups.md §11; docs/tui/features.md §3.10 / §5.6.

import React, { useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import { Modal } from "../primitives/Modal.js";
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
  readonly visible: boolean;
  readonly width?: number | string;
  readonly maxHeight?: number | string;
}

function HelpOverlayImpl(props: HelpOverlayProps): React.ReactElement {
  const {
    ctx,
    bindings,
    modeLabel,
    focusLabel,
    onClose,
    visible,
    width,
    maxHeight,
  } = props;
  const theme = useTheme();

  const [searchOpen, setSearchOpen] = useState<boolean>(false);

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

  useInput(
    (input, key) => {
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
        if (key.backspace) {
          const cur = stateRef.current.search;
          if (cur.length === 0) return;
          dispatch({ type: "SEARCH_SET", value: cur.slice(0, -1) });
          return;
        }
        if (input && input.length > 0 && !key.ctrl && !key.escape) {
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
    },
    { isActive: visible },
  );

  const title =
    focusLabel.length > 0
      ? `HELP \u00b7 mode: ${modeLabel} \u00b7 focus: ${focusLabel}`
      : `HELP \u00b7 mode: ${modeLabel}`;

  const searchLine = searchOpen
    ? `/${state.search}\u2588`
    : state.search.length > 0
      ? `/${state.search}`
      : "/search";

  let flatIdx = 0;

  return (
    <Modal visible={visible} title={title} width={width} maxHeight={maxHeight}>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{title}</Text>
          <Text dimColor>{searchLine}</Text>
        </Box>
        <Text> </Text>
        {model.sections.length === 0 ? (
          <Text dimColor>no bindings match</Text>
        ) : (
          model.sections.map((sec) => (
            <Box key={`s-${sec.category}`} flexDirection="column">
              <Text bold dimColor>
                {sec.category}
              </Text>
              {sec.rows.map((row) => {
                const rowIdx = flatIdx++;
                const selected = rowIdx === state.cursor;
                const keysText = formatKeys(row.keys);
                const body = row.annotation
                  ? `${keysText}  ${row.label}  ${row.annotation}`
                  : `${keysText}  ${row.label}`;
                return (
                  <Box key={`r-${sec.category}-${rowIdx}`} paddingLeft={2}>
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
        <Text> </Text>
        <Text dimColor>{`${model.totalRows} bindings`}</Text>
      </Box>
    </Modal>
  );
}

export const HelpOverlay = HelpOverlayImpl;
