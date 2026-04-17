// src/components/approval-modal.tsx
//
// <ApprovalModal> — the approval decision overlay (P7-T1).
//
// References: docs/tui/mockups.md §5; docs/tui/features.md §3.6, §3.7, §5.8.

import React, { useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import {
  approvalFormReducer,
  initialApprovalFormState,
} from "../approval/reducer.js";
import type {
  ApprovalFormState,
  ApprovalFormAction,
  ApprovalSubmitResult,
  PendingApproval,
} from "../approval/types.js";

export interface ApprovalModalProps {
  readonly approval: PendingApproval;
  readonly onDecide: (choice: string) => Promise<ApprovalSubmitResult>;
  /** Close the modal, leaving the run suspended. */
  readonly onSuspend: () => void;
  /** Esc — behaviour-equivalent to `onSuspend` in P7-T1 (see plan D5). */
  readonly onCancel: () => void;
  readonly width: number;
  readonly height: number;
}

function ApprovalModalImpl(props: ApprovalModalProps): React.ReactElement {
  const { approval, onDecide, onSuspend, onCancel, width, height } = props;
  const theme = useTheme();

  const options = approval.options;
  const [form, dispatch] = useReducer(
    (s: ApprovalFormState, a: ApprovalFormAction) =>
      approvalFormReducer(s, a, options.length),
    options,
    initialApprovalFormState,
  );
  const formRef = useRef<ApprovalFormState>(form);
  formRef.current = form;

  useInput((input, key) => {
    if (key.escape) {
      if (formRef.current.fsm === "submitting") return;
      onCancel();
      return;
    }
    if (formRef.current.fsm === "submitting") {
      // Block everything except Esc while submitting.
      return;
    }
    if (key.upArrow || input === "k") {
      dispatch({ type: "CURSOR_MOVE", delta: -1 });
      return;
    }
    if (key.downArrow || input === "j") {
      dispatch({ type: "CURSOR_MOVE", delta: 1 });
      return;
    }
    if (key.return) {
      const choice = options[formRef.current.cursor];
      if (choice === undefined) return;
      dispatch({ type: "SUBMIT_START" });
      void (async () => {
        try {
          const result = await onDecide(choice);
          if (result.kind === "ok") {
            dispatch({ type: "SUBMIT_OK" });
            onSuspend();
          } else if (result.kind === "locked") {
            dispatch({
              type: "SUBMIT_FAIL",
              error: "Another approve is in progress — retry",
            });
          } else if (result.kind === "notWaiting") {
            // The gate is gone; close. Upstream derivation will refresh.
            dispatch({ type: "SUBMIT_OK" });
            onSuspend();
          } else if (result.kind === "invalidChoice") {
            dispatch({ type: "SUBMIT_OK" });
            onSuspend();
          } else {
            dispatch({
              type: "SUBMIT_FAIL",
              error: result.message,
            });
          }
        } catch (err) {
          dispatch({
            type: "SUBMIT_FAIL",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return;
    }
    if (input === "s") {
      onSuspend();
    }
  });

  // ---- Rendering ----------------------------------------------------------

  const frame = theme.frame;
  const w = Math.max(20, width);
  const topEdge = frame.tl + frame.h.repeat(Math.max(0, w - 2)) + frame.tr;
  const botEdge = frame.bl + frame.h.repeat(Math.max(0, w - 2)) + frame.br;
  const innerWidth = Math.max(4, w - 4);

  const titleText = `APPROVAL \u00b7 ${approval.nodeId}`;
  const decideLabel =
    form.fsm === "submitting" ? "[ \u23ce Deciding\u2026 ]" : "[ \u23ce Decide ]";
  const suspendLabel = "[ s Suspend ]";

  // Wrap the prompt to innerWidth. Keep it simple — hard-wrap on spaces.
  const promptLines = wrapText(approval.prompt, innerWidth);

  return (
    <Box flexDirection="column" width={w} height={height}>
      <Text>{topEdge}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text bold>{titleText}</Text>
      </Box>
      <Text>{frame.v}</Text>
      {promptLines.map((line, idx) => (
        <Box key={`p-${idx}`} flexDirection="row">
          <Text>{frame.v} </Text>
          <Text>{line}</Text>
        </Box>
      ))}
      <Text>{frame.v}</Text>
      {options.map((opt, idx) => {
        const selected = idx === form.cursor;
        const glyph = selected ? "\u25c9" : "\u25cb";
        return (
          <Box key={`o-${idx}`} flexDirection="row">
            <Text>{frame.v} </Text>
            {selected ? (
              <Text
                bold
                color={theme.colors.accent.color}
                dimColor={theme.colors.accent.dim === true}
              >
                {glyph} {opt}
              </Text>
            ) : (
              <Text>
                {glyph} {opt}
              </Text>
            )}
          </Box>
        );
      })}
      <Text>{frame.v}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text inverse>{decideLabel}</Text>
        <Text> </Text>
        <Text>{suspendLabel}</Text>
      </Box>
      {form.fsm === "error" && form.error ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text
            color={theme.colors.danger.color}
            dimColor={theme.colors.danger.dim === true}
          >
            {form.error}
          </Text>
        </Box>
      ) : null}
      <Text>{botEdge}</Text>
    </Box>
  );
}

function wrapText(text: string, width: number): readonly string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > width) {
      if (line) {
        out.push(line);
        line = "";
      }
      // Chunk long words.
      let remaining = word;
      while (remaining.length > width) {
        out.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      line = remaining;
      continue;
    }
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length > width) {
      out.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(line);
  return out;
}

export const ApprovalModal = React.memo(ApprovalModalImpl);
ApprovalModal.displayName = "ApprovalModal";
