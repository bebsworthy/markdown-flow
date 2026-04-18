// src/components/resume-wizard-modal.tsx
//
// <ResumeWizardModal> — the resume wizard overlay (P7-T2).
//
// References: docs/tui/mockups.md §7; docs/tui/features.md §3.8.

import React, { useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { WorkflowDefinition } from "markflow";
import { useTheme } from "../theme/context.js";
import { Modal } from "../primitives/Modal.js";
import {
  initialResumeFormState,
  resumeFormReducer,
} from "../resume/reducer.js";
import type {
  InputRow,
  RerunNode,
  ResumableRun,
  ResumeFormAction,
  ResumeFormState,
  ResumeSubmitResult,
} from "../resume/types.js";

export interface ResumeWizardModalProps {
  readonly run: ResumableRun;
  readonly workflow: WorkflowDefinition | null;
  readonly nodes: readonly RerunNode[];
  readonly inputs: readonly InputRow[];
  readonly rerun: ReadonlySet<string>;
  readonly inputOverrides: Readonly<Record<string, string>>;
  readonly onToggleRerun: (nodeId: string) => void;
  readonly onSetInput: (key: string, value: string) => void;
  readonly onConfirm: () => Promise<ResumeSubmitResult>;
  readonly onCancel: () => void;
  readonly visible: boolean;
  readonly width?: number | string;
  readonly maxHeight?: number | string;
}

function ResumeWizardModalImpl(
  props: ResumeWizardModalProps,
): React.ReactElement {
  const {
    run,
    workflow,
    nodes,
    inputs,
    rerun,
    inputOverrides,
    onToggleRerun,
    onSetInput,
    onConfirm,
    onCancel,
    visible,
    width,
    maxHeight,
  } = props;
  const theme = useTheme();
  void workflow;

  const [form, dispatch] = useReducer(
    (s: ResumeFormState, a: ResumeFormAction) =>
      resumeFormReducer(s, a, {
        nodeCount: nodes.length,
        inputCount: inputs.length,
      }),
    { nodes, inputs },
    initialResumeFormState,
  );
  const formRef = useRef<ResumeFormState>(form);
  formRef.current = form;

  useInput(
    (input, key) => {
      if (key.escape) {
        if (formRef.current.fsm === "submitting") return;
        onCancel();
        return;
      }
      if (formRef.current.fsm === "submitting") return;

      if (key.tab) {
        if (key.shift) dispatch({ type: "FOCUS_PREV" });
        else dispatch({ type: "FOCUS_NEXT" });
        return;
      }
      if (key.upArrow || (input === "k" && form.focus !== "inputs")) {
        dispatch({ type: "CURSOR_MOVE", delta: -1 });
        return;
      }
      if (key.downArrow || (input === "j" && form.focus !== "inputs")) {
        dispatch({ type: "CURSOR_MOVE", delta: 1 });
        return;
      }
      if (key.return) {
        dispatch({ type: "SUBMIT_START" });
        void (async () => {
          try {
            const result = await onConfirm();
            if (result.kind === "ok") {
              dispatch({ type: "SUBMIT_OK" });
            } else if (result.kind === "locked") {
              dispatch({
                type: "SUBMIT_FAIL",
                error: "Another resume is in progress — retry",
              });
            } else if (result.kind === "notResumable") {
              dispatch({ type: "SUBMIT_OK" });
              onCancel();
            } else if (result.kind === "unknownNode") {
              dispatch({
                type: "SUBMIT_FAIL",
                error: `Re-run target '${result.nodeId}' is no longer in this run`,
              });
            } else {
              dispatch({ type: "SUBMIT_FAIL", error: result.message });
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
      if (form.focus === "rerun") {
        if (input === " ") {
          const row = nodes[form.rerunCursor];
          if (row) onToggleRerun(row.nodeId);
          return;
        }
      } else if (form.focus === "inputs") {
        const row = inputs[form.inputsCursor];
        if (!row) return;
        const current = inputOverrides[row.key] ?? row.draft;
        if (key.backspace) {
          const next = current.length > 0 ? current.slice(0, -1) : current;
          if (next !== current) {
            onSetInput(row.key, next);
            dispatch({ type: "INPUT_EDIT", key: row.key, value: next });
          }
          return;
        }
        if (input && input.length > 0 && !key.ctrl && !key.escape) {
          const next = current + input;
          onSetInput(row.key, next);
          dispatch({ type: "INPUT_EDIT", key: row.key, value: next });
          return;
        }
      }
    },
    { isActive: visible },
  );

  const titleText = `RESUME \u00b7 run ${run.runId} \u00b7 ${run.workflowName}`;
  const statusLine = `status: ${run.status} \u00b7 ${run.lastEventLabel}`;
  const startedLine = `started: ${run.startedAt}`;

  const editedCount = inputs.reduce((acc, row) => {
    const draft = inputOverrides[row.key] ?? row.draft;
    return draft !== row.original ? acc + 1 : acc;
  }, 0);
  const summaryLine = `${rerun.size} re-run \u00b7 ${editedCount} input changed`;

  const resumeLabel =
    form.fsm === "submitting"
      ? "[ \u23ce Resuming\u2026 ]"
      : "[ \u23ce Resume ]";
  const previewLabel = "[ p Preview events ]";
  const cancelLabel = "[ Esc Cancel ]";

  const focusMark = (f: typeof form.focus): string =>
    form.focus === f ? "\u25b8 " : "  ";

  return (
    <Modal
      visible={visible}
      title={titleText}
      width={width}
      maxHeight={maxHeight}
    >
      <Box flexDirection="column">
        <Text>{statusLine}</Text>
        <Text>{startedLine}</Text>
        <Text> </Text>
        <Text bold>{focusMark("rerun")}Nodes to re-run:</Text>
        {nodes.length === 0 ? (
          <Box paddingLeft={2}>
            <Text>(no tokens found)</Text>
          </Box>
        ) : (
          nodes.map((n, idx) => {
            const checked = rerun.has(n.nodeId);
            const glyph = checked ? "[x]" : "[ ]";
            const selected = form.focus === "rerun" && idx === form.rerunCursor;
            return (
              <Box key={`n-${n.tokenId}`} paddingLeft={2}>
                {selected ? (
                  <Text
                    bold
                    color={theme.colors.accent.color}
                    dimColor={theme.colors.accent.dim === true}
                  >
                    {`${glyph} ${n.nodeId} \u2014 ${n.summary}`}
                  </Text>
                ) : (
                  <Text>
                    {`${glyph} ${n.nodeId} \u2014 ${n.summary}`}
                  </Text>
                )}
              </Box>
            );
          })
        )}
        <Text> </Text>
        <Text bold>{focusMark("inputs")}Inputs (audit-logged):</Text>
        {inputs.length === 0 ? (
          <Box paddingLeft={2}>
            <Text>(no declared inputs)</Text>
          </Box>
        ) : (
          inputs.map((row, idx) => {
            const draft = inputOverrides[row.key] ?? row.draft;
            const edited = draft !== row.original;
            const selected = form.focus === "inputs" && idx === form.inputsCursor;
            const tail = edited ? `  \u2190 edited` : "";
            const body = `${row.key} = ${draft}${tail}`;
            return (
              <Box key={`i-${row.key}`} paddingLeft={2}>
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
          })
        )}
        <Text> </Text>
        <Text>{summaryLine}</Text>
        <Box flexDirection="row" gap={1}>
          <Text inverse={form.focus === "confirm"}>{resumeLabel}</Text>
          <Text>{previewLabel}</Text>
          <Text>{cancelLabel}</Text>
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

export const ResumeWizardModal = ResumeWizardModalImpl;
