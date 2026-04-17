// src/components/step-detail-panel.tsx
//
// Stateless presentational detail panel for a selected step row (P6-T2).
// Receives a pre-projected `StepDetailModel` and width/height budget;
// renders the mockup §1 / §4 / §6 bottom-pane layouts.
//
// Authoritative references:
//   - docs/tui/features.md §3.4
//   - docs/tui/mockups.md §1 / §4 / §6 bottom panes
//   - docs/tui/plans/P6-T2.md §5

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { StepDetailField, StepDetailModel } from "../steps/detail-types.js";

export interface StepDetailPanelProps {
  readonly model: StepDetailModel;
  readonly width: number;
  readonly height: number;
}

/** Minimum rows to render the full set of fields. */
export const MIN_DETAIL_ROWS = 9;
const COLLAPSE_ROWS = 5;
const LABEL_WIDTH = 10;
const INDENT = "    ";
const PAIR_GAP = "   ";

function padLabel(label: string): string {
  if (label.length >= LABEL_WIDTH) return label;
  return label + " ".repeat(LABEL_WIDTH - label.length);
}

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max === 1) return "\u2026";
  return text.slice(0, max - 1) + "\u2026";
}

function StepDetailPanelImpl({
  model,
  width,
  height,
}: StepDetailPanelProps): React.ReactElement | null {
  const theme = useTheme();

  if (width <= 0 || height <= 0) return null;

  if (model.kind === "empty") {
    return renderDim(
      "select a step to see details",
      theme.colors.dim.color,
      theme.colors.dim.dim === true,
      width,
      height,
    );
  }

  if (model.kind === "not-found") {
    return renderDim(
      `step ${model.rowId} no longer in run`,
      theme.colors.dim.color,
      theme.colors.dim.dim === true,
      width,
      height,
    );
  }

  if (model.kind === "aggregate") {
    return renderTokenOrAggregate({
      theme,
      headline: model.data.headline,
      role: model.data.role,
      statusLine: null,
      fields: model.data.fields,
      stderrTail: [],
      stderrTailNote: null,
      width,
      height,
    });
  }

  // token
  return renderTokenOrAggregate({
    theme,
    headline: model.data.headline,
    role: model.data.role,
    statusLine: model.data.statusLine,
    fields: model.data.fields,
    stderrTail: model.data.stderrTail,
    stderrTailNote: model.data.stderrTailNote,
    width,
    height,
  });
}

function renderDim(
  text: string,
  color: string | undefined,
  dim: boolean,
  width: number,
  height: number,
): React.ReactElement {
  const padRows = Math.max(0, height - 1);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={color} dimColor={dim}>
        {truncate(text, width)}
      </Text>
      {Array.from({ length: padRows }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

interface RenderArgs {
  readonly theme: ReturnType<typeof useTheme>;
  readonly headline: string;
  readonly role: string;
  readonly statusLine: string | null;
  readonly fields: ReadonlyArray<StepDetailField>;
  readonly stderrTail: ReadonlyArray<{ seq: number | null; text: string }>;
  readonly stderrTailNote: string | null;
  readonly width: number;
  readonly height: number;
}

function renderTokenOrAggregate(args: RenderArgs): React.ReactElement {
  const { theme, headline, role, statusLine, fields, stderrTail, stderrTailNote, width, height } = args;

  if (height < COLLAPSE_ROWS) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text color={(theme.colors as Record<string, { color?: string; dim?: boolean }>)[role]?.color}>
          {truncate(headline, width)}
        </Text>
        <Text color={theme.colors.dim.color} dimColor={theme.colors.dim.dim === true}>
          detail pane collapsed
        </Text>
        {Array.from({ length: Math.max(0, height - 2) }, (_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
      </Box>
    );
  }

  // Height budget:
  //   row 0: headline
  //   row 1: blank spacer
  //   rows: statusLine (optional), fields, stderr header + lines.
  // We omit fields in priority order to fit `height`.
  const availableRows = Math.max(0, height - 2);
  const stderrRows = stderrTail.length > 0
    ? 1 /* spacer */ + 1 /* header */ + stderrTail.length
    : 0;
  const statusLineRows = statusLine ? 1 : 0;

  // Compute field rows (each pair-pair combined into one row; full = 1 row each).
  const visibleFields = pickVisibleFields(
    fields,
    Math.max(0, availableRows - stderrRows - statusLineRows),
  );
  const pairRows = buildPairRows(visibleFields);

  const padRows = Math.max(
    0,
    availableRows - statusLineRows - pairRows.length - stderrRows,
  );

  const roleColor = (theme.colors as Record<string, { color?: string; dim?: boolean }>)[role];
  const dimSpec = theme.colors.dim;
  const labelColor = dimSpec.color;
  const labelDim = dimSpec.dim === true;

  const lineBudget = Math.max(1, width);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={roleColor?.color} dimColor={roleColor?.dim === true}>
        {truncate(`${INDENT}${headline}`, lineBudget)}
      </Text>
      <Text> </Text>
      {statusLine ? (
        <Text color={roleColor?.color}>
          {truncate(`${INDENT}${statusLine}`, lineBudget)}
        </Text>
      ) : null}
      {pairRows.map((row, idx) => (
        <Text key={`row-${idx}`}>
          <Text>{INDENT}</Text>
          {row.left ? (
            <>
              <Text color={labelColor} dimColor={labelDim}>
                {padLabel(row.left.label)}
              </Text>
              <Text>{truncate(row.left.value, columnValueBudget(width, row.kind))}</Text>
            </>
          ) : null}
          {row.kind === "pair" && row.right ? (
            <>
              <Text>{PAIR_GAP}</Text>
              <Text color={labelColor} dimColor={labelDim}>
                {padLabel(row.right.label)}
              </Text>
              <Text>{truncate(row.right.value, columnValueBudget(width, "pair"))}</Text>
            </>
          ) : null}
        </Text>
      ))}
      {stderrTail.length > 0 ? (
        <>
          <Text> </Text>
          <Text color={labelColor} dimColor={labelDim}>
            {truncate(
              `${INDENT}stderr tail ${stderrTailNote ?? ""}`.trimEnd(),
              lineBudget,
            )}
          </Text>
          {stderrTail.map((line, idx) => (
            <Text key={`stderr-${idx}`}>
              {truncate(`${INDENT}  ${line.text}`, lineBudget)}
            </Text>
          ))}
        </>
      ) : null}
      {Array.from({ length: padRows }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

interface PairRow {
  readonly kind: "pair" | "full";
  readonly left: StepDetailField | null;
  readonly right: StepDetailField | null;
}

/**
 * Pack the field list into display rows: consecutive `pair`-layout fields
 * merge 2-per-row; `full` fields always take a dedicated row.
 */
function buildPairRows(fields: ReadonlyArray<StepDetailField>): PairRow[] {
  const rows: PairRow[] = [];
  let pending: StepDetailField | null = null;
  for (const f of fields) {
    if (f.layout === "full") {
      if (pending) {
        rows.push({ kind: "pair", left: pending, right: null });
        pending = null;
      }
      rows.push({ kind: "full", left: f, right: null });
    } else {
      if (pending) {
        rows.push({ kind: "pair", left: pending, right: f });
        pending = null;
      } else {
        pending = f;
      }
    }
  }
  if (pending) rows.push({ kind: "pair", left: pending, right: null });
  return rows;
}

/**
 * Pick which fields to show given `maxRows`. Priority (always kept):
 * type, attempt, timeout, exit, edge, local. Dropped in reverse order:
 * `last log` \u2192 `global` \u2192 `ended` \u2192 `started`.
 */
function pickVisibleFields(
  fields: ReadonlyArray<StepDetailField>,
  maxRows: number,
): ReadonlyArray<StepDetailField> {
  if (maxRows <= 0) return [];
  const dropOrder = ["last log", "global", "ended", "started"];
  let current = fields.slice();
  while (estimateRows(current) > maxRows && dropOrder.length > 0) {
    const victim = dropOrder.shift()!;
    current = current.filter((f) => f.key !== victim);
  }
  return current;
}

function estimateRows(fields: ReadonlyArray<StepDetailField>): number {
  const rows = buildPairRows(fields);
  return rows.length;
}

function columnValueBudget(width: number, kind: "pair" | "full"): number {
  if (kind === "full") {
    return Math.max(1, width - INDENT.length - LABEL_WIDTH);
  }
  // Pair splits into roughly half.
  const half = Math.floor((width - INDENT.length) / 2);
  return Math.max(1, half - LABEL_WIDTH);
}

export const StepDetailPanel = React.memo(StepDetailPanelImpl);
StepDetailPanel.displayName = "StepDetailPanel";
