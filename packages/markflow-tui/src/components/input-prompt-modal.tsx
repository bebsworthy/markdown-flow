// src/components/input-prompt-modal.tsx
//
// <InputPromptModal> — the run-entry input-prompt overlay (P9-T1).
//
// References: docs/tui/features.md §3.1 / §5.7; docs/tui/plans/P9-T1.md §4.3.
//
// Chrome mirrors <ResumeWizardModal>: bordered box, title row, one row per
// declared input, footer with `[ ⏎ Run ]` + `[ Esc Cancel ]`. Row drafts
// live in a local reducer (plan §6 D2). The modal never self-closes on
// submit success — the host dispatches `OVERLAY_CLOSE` once `onRunStart`
// fires. Submit failures flip the local FSM to `error` and stay mounted.

import React, { useReducer, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import {
  canSubmitRunInputs,
  composeRunInputs,
  missingRequiredInputs,
} from "../runStart/derive.js";
import {
  initialRunInputFormState,
  runInputFormReducer,
} from "../runStart/reducer.js";
import type {
  RunInputRow,
  RunWorkflowResult,
} from "../runStart/types.js";

export interface InputPromptModalProps {
  readonly workflowName: string;
  readonly sourceFile: string;
  readonly rows: readonly RunInputRow[];
  readonly onSubmit: (
    inputs: Readonly<Record<string, string>>,
  ) => Promise<RunWorkflowResult>;
  readonly onCancel: () => void;
  readonly width: number;
  readonly height: number;
}

function InputPromptModalImpl(
  props: InputPromptModalProps,
): React.ReactElement {
  const { workflowName, sourceFile, rows, onSubmit, onCancel, width, height } =
    props;
  const theme = useTheme();

  const [form, dispatch] = useReducer(
    runInputFormReducer,
    rows,
    initialRunInputFormState,
  );
  const formRef = useRef(form);
  formRef.current = form;
  // Mirror drafts synchronously so back-to-back keystrokes (which all fire
  // before React flushes a re-render) never clobber each other on a stale
  // `form.rows[cursor].draft` value. Seeded once from the incoming `rows`
  // prop (the prop only changes when the host opens a new modal instance).
  const draftsRef = useRef<Map<string, string>>(
    new Map(rows.map((r) => [r.key, r.draft])),
  );

  const canSubmit = canSubmitRunInputs(form.rows);
  const missing = missingRequiredInputs(form.rows);

  useInput((input, key) => {
    if (key.escape) {
      if (formRef.current.fsm === "submitting") return;
      onCancel();
      return;
    }
    if (formRef.current.fsm === "submitting") return;

    if (key.tab) {
      if (key.shift) dispatch({ type: "CURSOR_MOVE", delta: -1 });
      else dispatch({ type: "CURSOR_MOVE", delta: 1 });
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

    if (key.return) {
      // Build a snapshot with the ref-tracked drafts so last-frame input is
      // always reflected even if React hasn't yet flushed a re-render.
      const snapshotRows = formRef.current.rows.map((r) => ({
        ...r,
        draft: draftsRef.current.get(r.key) ?? r.draft,
      }));
      if (canSubmitRunInputs(snapshotRows)) {
        dispatch({ type: "SUBMIT_START" });
        void (async () => {
          try {
            const composed = composeRunInputs(snapshotRows);
            const result = await onSubmit(composed);
            if (result.kind === "ok") {
              dispatch({ type: "SUBMIT_OK" });
            } else if (result.kind === "locked") {
              dispatch({
                type: "SUBMIT_FAIL",
                error: "Run is locked — retry",
              });
            } else if (result.kind === "invalidInputs") {
              dispatch({
                type: "SUBMIT_FAIL",
                error: `Missing required inputs: ${result.missing.join(", ")}`,
              });
            } else if (result.kind === "parseError") {
              dispatch({ type: "SUBMIT_FAIL", error: result.message });
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
      // Submit blocked — advance cursor instead (plan §6 D4).
      dispatch({ type: "CURSOR_MOVE", delta: 1 });
      return;
    }

    // Row-level edits — only when a valid row is focused. Read the draft
    // from the ref so rapid keystrokes don't clobber each other on stale
    // closures (React may not have flushed a re-render yet).
    const current = formRef.current;
    const row = current.rows[current.cursor];
    if (!row) return;
    const liveDraft = draftsRef.current.get(row.key) ?? row.draft;
    if (key.backspace || key.delete) {
      const next = liveDraft.length > 0 ? liveDraft.slice(0, -1) : liveDraft;
      if (next !== liveDraft) {
        draftsRef.current.set(row.key, next);
        dispatch({ type: "SET_DRAFT", key: row.key, value: next });
      }
      return;
    }
    if (input && input.length > 0 && !key.ctrl && !key.meta) {
      const next = liveDraft + input;
      draftsRef.current.set(row.key, next);
      dispatch({ type: "SET_DRAFT", key: row.key, value: next });
      return;
    }
  });

  // ---- Rendering ----------------------------------------------------------

  const frame = theme.frame;
  const w = Math.max(20, width);
  const topEdge = frame.tl + frame.h.repeat(Math.max(0, w - 2)) + frame.tr;
  const botEdge = frame.bl + frame.h.repeat(Math.max(0, w - 2)) + frame.br;

  const titleText = `RUN \u00b7 ${workflowName}`;
  const subtitleText = `source: ${sourceFile}`;

  const runLabel =
    form.fsm === "submitting" ? "[ \u23ce Starting\u2026 ]" : "[ \u23ce Run ]";
  const cancelLabel = "[ Esc Cancel ]";

  return (
    <Box flexDirection="column" width={w} height={height}>
      <Text>{topEdge}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text bold>{titleText}</Text>
      </Box>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {subtitleText}
        </Text>
      </Box>
      <Text>{frame.v}</Text>
      {form.rows.length === 0 ? (
        <Box flexDirection="row">
          <Text>{frame.v}   </Text>
          <Text>(no declared inputs)</Text>
        </Box>
      ) : (
        form.rows.map((row, idx) => {
          const selected = idx === form.cursor;
          const mark = row.required && row.draft === "" && row.placeholder === ""
            ? "*"
            : " ";
          const valueShown = row.draft !== "" ? row.draft : row.placeholder;
          const placeholderTag =
            row.draft === "" && row.placeholder !== ""
              ? `  (default: ${row.placeholder})`
              : "";
          const body = `${mark} ${row.key} = ${valueShown}${placeholderTag}`;
          const required = row.required;
          const blocking = required && row.draft === "" && row.placeholder === "";
          return (
            <Box key={`r-${row.key}`} flexDirection="row">
              <Text>{frame.v}   </Text>
              {selected ? (
                <Text
                  bold
                  color={theme.colors.accent.color}
                  dimColor={theme.colors.accent.dim === true}
                >
                  {body}
                </Text>
              ) : blocking ? (
                <Text
                  color={theme.colors.waiting.color}
                  dimColor={theme.colors.waiting.dim === true}
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
      <Text>{frame.v}</Text>
      <Box flexDirection="row">
        <Text>{frame.v} </Text>
        {canSubmit ? (
          <Text inverse>{runLabel}</Text>
        ) : (
          <Text
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {runLabel}
          </Text>
        )}
        <Text> </Text>
        <Text>{cancelLabel}</Text>
      </Box>
      {!canSubmit && missing.length > 0 ? (
        <Box flexDirection="row">
          <Text>{frame.v} </Text>
          <Text
            color={theme.colors.waiting.color}
            dimColor={theme.colors.waiting.dim === true}
          >
            {`required: ${missing.join(", ")}`}
          </Text>
        </Box>
      ) : null}
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

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const InputPromptModal = InputPromptModalImpl;
