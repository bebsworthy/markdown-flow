// src/components/workflow-preview.tsx
//
// The right pane of the workflow browser. Pure rendering — no useInput.
// Uses formatters from `src/browser/preview-layout.ts` for all strings.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import {
  countSteps,
  formatDiagnostics,
  formatFlowSummary,
  formatInputsSummary,
  formatStepCountLine,
} from "../browser/preview-layout.js";
import type { ResolvedEntry } from "../browser/types.js";

export interface WorkflowPreviewProps {
  readonly resolved: ResolvedEntry | null;
  readonly width: number;
  readonly height: number;
}

const MAX_DIAGNOSTIC_LINES = 5;

function WorkflowPreviewImpl({
  resolved,
  width,
  height,
}: WorkflowPreviewProps): React.ReactElement {
  const theme = useTheme();

  if (resolved === null) {
    return (
      <Box width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          Select a workflow to preview
        </Text>
      </Box>
    );
  }

  if (resolved.status === "missing") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.danger.color}
          dimColor={theme.colors.danger.dim === true}
        >
          {theme.glyphs.fail} {resolved.errorReason ?? "missing"}
        </Text>
        <Text>{resolved.entry.source}</Text>
      </Box>
    );
  }

  if (resolved.status === "parse-error") {
    const glyphs = {
      error: theme.glyphs.fail,
      warning: theme.capabilities.unicode ? "⚠" : "[warn]",
    };
    const diagLines = formatDiagnostics(resolved.diagnostics, glyphs);
    const shown = diagLines.slice(0, MAX_DIAGNOSTIC_LINES);
    const extra = diagLines.length - shown.length;

    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.danger.color}
          dimColor={theme.colors.danger.dim === true}
        >
          {theme.glyphs.fail} parse
        </Text>
        <Text>{resolved.entry.source}</Text>
        {resolved.workflow ? (
          <Box marginTop={1} flexDirection="column">
            <Text bold>{`# ${resolved.workflow.name}`}</Text>
          </Box>
        ) : null}
        {shown.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            {shown.map((line, idx) => (
              <Text key={idx}>{line}</Text>
            ))}
            {extra > 0 ? (
              <Text
                color={theme.colors.dim.color}
                dimColor={theme.colors.dim.dim === true}
              >
                {`+${extra} more`}
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  }

  // status === "valid"
  const workflow = resolved.workflow!;
  const inputsLines = formatInputsSummary(workflow.inputs);
  const flowLines = formatFlowSummary(workflow);
  const counts = countSteps(workflow);
  const countLine = formatStepCountLine(counts);
  const diagGlyphs = {
    error: theme.glyphs.fail,
    warning: theme.capabilities.unicode ? "⚠" : "[warn]",
  };
  const diagLines = formatDiagnostics(resolved.diagnostics, diagGlyphs);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text bold>{`# ${workflow.name}`}</Text>
      {workflow.description ? (
        <Box marginTop={1}>
          <Text>{workflow.description}</Text>
        </Box>
      ) : null}

      {inputsLines.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {inputsLines.map((line, idx) => (
            <Text key={`in-${idx}`}>{line}</Text>
          ))}
        </Box>
      ) : null}

      {flowLines.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {flowLines.map((line, idx) => (
            <Text key={`fl-${idx}`}>{line}</Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text>{countLine}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {diagLines.length === 0 ? (
          <Text
            color={theme.colors.complete.color}
            dimColor={theme.colors.complete.dim === true}
          >
            {`diagnostics: ${theme.glyphs.ok} validated`}
          </Text>
        ) : (
          diagLines.map((line, idx) => <Text key={`dg-${idx}`}>{line}</Text>)
        )}
      </Box>
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const WorkflowPreview = WorkflowPreviewImpl;
