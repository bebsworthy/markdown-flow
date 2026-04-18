// src/components/approval-modal.tsx
//
// <ApprovalModal> — the approval decision overlay (P7-T1).
//
// References: docs/tui/mockups.md §5; docs/tui/features.md §3.6, §3.7, §5.8.

import React, { useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import { Modal } from "../primitives/Modal.js";
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
  readonly onSuspend: () => void;
  readonly onCancel: () => void;
  readonly visible: boolean;
  readonly width?: number | string;
  readonly maxHeight?: number | string;
}

function ApprovalModalImpl(props: ApprovalModalProps): React.ReactElement {
  const { approval, onDecide, onSuspend, onCancel, visible, width, maxHeight } =
    props;
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

  useInput(
    (input, key) => {
      if (key.escape) {
        if (formRef.current.fsm === "submitting") return;
        onCancel();
        return;
      }
      if (formRef.current.fsm === "submitting") return;

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
    },
    { isActive: visible },
  );

  const titleText = `APPROVAL \u00b7 ${approval.nodeId}`;
  const decideLabel =
    form.fsm === "submitting" ? "[ \u23ce Deciding\u2026 ]" : "[ \u23ce Decide ]";
  const suspendLabel = "[ s Suspend ]";

  return (
    <Modal
      visible={visible}
      title={titleText}
      width={width}
      maxHeight={maxHeight}
    >
      <Box flexDirection="column">
        <Text wrap="wrap">{approval.prompt}</Text>
        <Text> </Text>
        {options.map((opt, idx) => {
          const selected = idx === form.cursor;
          const glyph = selected ? "\u25c9" : "\u25cb";
          return (
            <Box key={`o-${idx}`}>
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
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          <Text inverse>{decideLabel}</Text>
          <Text>{suspendLabel}</Text>
        </Box>
        {form.fsm === "error" && form.error ? (
          <Text
            color={theme.colors.danger.color}
            dimColor={theme.colors.danger.dim === true}
          >
            {form.error}
          </Text>
        ) : null}
      </Box>
    </Modal>
  );
}

export const ApprovalModal = ApprovalModalImpl;
