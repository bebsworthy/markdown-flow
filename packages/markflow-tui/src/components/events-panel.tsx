// src/components/events-panel.tsx
//
// Stateless events-panel component (P6-T4). Receives a pre-derived
// `EventsPanelModel` and renders header + banner + rows + footer.
//
// Authoritative references:
//   - docs/tui/plans/P6-T4.md §1

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import { emptyReasonLabel } from "../events/derive.js";
import type { EventsPanelModel } from "../events/types.js";
import type { ColorRole } from "../theme/tokens.js";

export interface EventsPanelProps {
  readonly model: EventsPanelModel;
  readonly width: number;
  readonly height: number;
  readonly searchOpen?: boolean;
  readonly searchDraft?: string;
}

function roleColor(
  role: ColorRole,
  theme: ReturnType<typeof useTheme>,
): { color?: string; dim?: boolean } {
  const spec = theme.colors[role];
  return { color: spec.color, dim: spec.dim === true };
}

function seqCell(seq: number): string {
  const s = String(seq);
  return s.length >= 5 ? s : " ".repeat(5 - s.length) + s;
}

function nodeCell(node: string | null): string {
  const WIDTH = 12;
  const raw = node ?? "—";
  if (raw.length >= WIDTH) return raw.slice(0, WIDTH);
  return raw + " ".repeat(WIDTH - raw.length);
}

function EventsPanelImpl({
  model,
  width,
  height,
  searchOpen,
  searchDraft,
}: EventsPanelProps): React.ReactElement | null {
  const theme = useTheme();
  if (width <= 0 || height <= 0) return null;

  if (model.empty) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {emptyReasonLabel(model.empty)}
        </Text>
        {Array.from({ length: Math.max(0, height - 1) }, (_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
      </Box>
    );
  }

  const bannerText = model.banner
    ? `\u25B2 paused \u00B7 ${model.banner.newSincePause} new events since pause`
    : null;
  const footerText = model.footer
    ? model.footer.kind === "live-tail"
      ? "\u23F5 live"
      : `\u25BC more below (${model.footer.hidden} hidden)`
    : null;
  const searchLine =
    searchOpen === true ? `/ ${searchDraft ?? ""}` : null;

  const rowsUsed =
    1 +
    (bannerText ? 1 : 0) +
    (searchLine ? 1 : 0) +
    model.rows.length +
    (footerText ? 1 : 0);
  const pad = Math.max(0, height - rowsUsed);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={theme.colors.accent.color}
        dimColor={theme.colors.accent.dim === true}
      >
        {model.header}
      </Text>
      {bannerText ? (
        <Text color={theme.colors.waiting.color}>{bannerText}</Text>
      ) : null}
      {searchLine ? (
        <Text
          color={theme.colors.accent.color}
          dimColor={theme.colors.accent.dim === true}
        >
          {searchLine}
        </Text>
      ) : null}
      {model.rows.map((row) => {
        const rc = roleColor(row.role, theme);
        return (
          <Box key={`${row.seq}`} flexDirection="row">
            <Text
              color={theme.colors.dim.color}
              dimColor={theme.colors.dim.dim === true}
            >
              {row.ts}
            </Text>
            <Text> </Text>
            <Text color={rc.color} dimColor={rc.dim}>
              {row.kindLabel}
            </Text>
            <Text> </Text>
            <Text
              color={theme.colors.dim.color}
              dimColor={theme.colors.dim.dim === true}
            >
              {seqCell(row.seq)}
            </Text>
            <Text> </Text>
            <Text>{nodeCell(row.nodeId)}</Text>
            <Text> </Text>
            <Text>{row.summary}</Text>
          </Box>
        );
      })}
      {footerText ? (
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {footerText}
        </Text>
      ) : null}
      {Array.from({ length: pad }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

export const EventsPanel = React.memo(EventsPanelImpl);
EventsPanel.displayName = "EventsPanel";
