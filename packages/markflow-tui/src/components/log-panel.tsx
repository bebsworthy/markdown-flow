// src/components/log-panel.tsx
//
// Stateless presentational log-panel component (P6-T3). Receives a
// pre-derived `LogPanelModel` and renders header + banner + rows + footer.
// ANSI segments map to Ink <Text> props (color / bold / dim / italic /
// underline). Unrecognised / extended colors fall back to default fg.
//
// Authoritative references:
//   - docs/tui/features.md §3.5
//   - docs/tui/mockups.md §8 (following) / §9 (paused)

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { AnsiColor, LogLineSegment, LogPanelModel } from "../log/types.js";
import { emptyReasonLabel } from "../log/derive.js";

export interface LogPanelProps {
  readonly model: LogPanelModel;
  readonly width: number;
  readonly height: number;
}

const NAMED_COLORS: ReadonlySet<string> = new Set([
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "gray", "brightRed", "brightGreen", "brightYellow", "brightBlue",
  "brightMagenta", "brightCyan", "brightWhite",
]);

function ansiColorToInk(c: AnsiColor | undefined): string | undefined {
  if (c === undefined) return undefined;
  if (typeof c === "string") {
    return NAMED_COLORS.has(c) ? c : undefined;
  }
  if (c.kind === "rgb") {
    const h = (n: number): string => n.toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }
  // 256-color passthrough isn't supported by Ink's <Text color> directly;
  // fall back to default fg — the row text still renders correctly.
  return undefined;
}

function Segment({ seg }: { seg: LogLineSegment }): React.ReactElement {
  return (
    <Text
      color={ansiColorToInk(seg.color)}
      backgroundColor={ansiColorToInk(seg.bgColor)}
      bold={seg.bold}
      dimColor={seg.dim}
      italic={seg.italic}
      underline={seg.underline}
    >
      {seg.text}
    </Text>
  );
}

function LogPanelImpl({
  model,
  width,
  height,
}: LogPanelProps): React.ReactElement | null {
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

  // Header + optional banner + rows + footer.
  const headerText = model.header;
  const bannerText = model.banner
    ? `\u25B2 paused \u00B7 ${model.banner.linesSincePause} new lines since pause \u00B7 F resume follow`
    : null;
  const footerText = model.footer
    ? model.footer.kind === "live-tail"
      ? "\u23F5 live"
      : `\u25BC more below (${model.footer.hidden} hidden)`
    : null;

  const rowsUsed =
    1 /* header */ +
    (bannerText ? 1 : 0) +
    model.rows.length +
    (footerText ? 1 : 0);
  const pad = Math.max(0, height - rowsUsed);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={theme.colors.accent.color}
        dimColor={theme.colors.accent.dim === true}
      >
        {headerText}
      </Text>
      {bannerText ? (
        <Text color={theme.colors.waiting.color}>{bannerText}</Text>
      ) : null}
      {model.rows.map((row, i) => {
        // When wrap produces multiple rows for one line, the derived `text`
        // is a pre-truncated/wrapped slice. Re-render styled segments when
        // the text matches the full line exactly; otherwise render plain.
        const full = row.line.segments.map((s) => s.text).join("");
        if (full === row.text) {
          return (
            <Text key={`row-${i}`}>
              {row.line.segments.map((seg, j) => (
                <Segment key={j} seg={seg} />
              ))}
            </Text>
          );
        }
        return <Text key={`row-${i}`}>{row.text}</Text>;
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

export const LogPanel = React.memo(LogPanelImpl);
LogPanel.displayName = "LogPanel";
