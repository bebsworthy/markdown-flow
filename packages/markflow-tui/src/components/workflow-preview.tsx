// src/components/workflow-preview.tsx
//
// Bottom-pane preview of the selected workflow. Renders the raw markdown
// content with collapsible fenced code blocks.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/context.js";
import type { ResolvedEntry } from "../browser/types.js";

export interface WorkflowPreviewProps {
  readonly resolved: ResolvedEntry | null;
  readonly width: number;
  readonly height: number;
  readonly codeBlocksCollapsed: boolean;
}

interface MarkdownSection {
  readonly kind: "text" | "code";
  readonly lines: ReadonlyArray<string>;
  readonly lang?: string;
}

function parseMarkdownSections(raw: string): ReadonlyArray<MarkdownSection> {
  const lines = raw.split("\n");
  const sections: MarkdownSection[] = [];
  let current: string[] = [];
  let inCode = false;
  let codeLang = "";

  for (const line of lines) {
    if (!inCode && /^```/.test(line)) {
      if (current.length > 0) {
        sections.push({ kind: "text", lines: current });
        current = [];
      }
      inCode = true;
      codeLang = line.replace(/^```\s*/, "").trim();
      current = [];
    } else if (inCode && /^```\s*$/.test(line)) {
      sections.push({ kind: "code", lines: current, lang: codeLang });
      current = [];
      inCode = false;
      codeLang = "";
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push({ kind: inCode ? "code" : "text", lines: current, lang: inCode ? codeLang : undefined });
  }
  return sections;
}

function renderTextLine(
  line: string,
): React.ReactElement {
  if (/^#{1,3}\s/.test(line)) {
    return <Text bold>{line}</Text>;
  }
  if (/^-\s/.test(line)) {
    return <Text>{line}</Text>;
  }
  if (line.trim() === "") {
    return <Text> </Text>;
  }
  return <Text>{line}</Text>;
}

function WorkflowPreviewImpl({
  resolved,
  width,
  height,
  codeBlocksCollapsed,
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

  const sourcePath = resolved.absolutePath ?? resolved.entry.source;
  const rawContent = resolved.rawContent;

  if (!rawContent) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          {sourcePath}
        </Text>
        <Text
          color={theme.colors.dim.color}
          dimColor={theme.colors.dim.dim === true}
        >
          (no content)
        </Text>
      </Box>
    );
  }

  const sections = parseMarkdownSections(rawContent);
  const elements: React.ReactElement[] = [];
  let lineCount = 0;
  const maxLines = Math.max(0, height - 1);

  // Source path header (dim)
  elements.push(
    <Text
      key="path"
      color={theme.colors.dim.color}
      dimColor={theme.colors.dim.dim === true}
    >
      {sourcePath}
    </Text>,
  );
  lineCount += 1;

  for (let si = 0; si < sections.length && lineCount < maxLines; si++) {
    const section = sections[si]!;
    if (section.kind === "text") {
      for (let li = 0; li < section.lines.length && lineCount < maxLines; li++) {
        const line = section.lines[li]!;
        elements.push(
          <React.Fragment key={`t-${si}-${li}`}>
            {renderTextLine(line)}
          </React.Fragment>,
        );
        lineCount += 1;
      }
    } else {
      // Code block
      const langTag = section.lang ? `\`\`\`${section.lang}` : "```";
      if (codeBlocksCollapsed) {
        const foldGlyph = theme.capabilities.unicode ? "\u25B8" : ">";
        elements.push(
          <Text
            key={`c-${si}`}
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {foldGlyph} {langTag} ({section.lines.length} {section.lines.length === 1 ? "line" : "lines"})
          </Text>,
        );
        lineCount += 1;
      } else {
        elements.push(
          <Text
            key={`co-${si}`}
            color={theme.colors.dim.color}
            dimColor={theme.colors.dim.dim === true}
          >
            {langTag}
          </Text>,
        );
        lineCount += 1;
        for (let li = 0; li < section.lines.length && lineCount < maxLines; li++) {
          elements.push(
            <Text key={`cl-${si}-${li}`}>  {section.lines[li]}</Text>,
          );
          lineCount += 1;
        }
        if (lineCount < maxLines) {
          elements.push(
            <Text
              key={`cc-${si}`}
              color={theme.colors.dim.color}
              dimColor={theme.colors.dim.dim === true}
            >
              ```
            </Text>,
          );
          lineCount += 1;
        }
      }
    }
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {elements}
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const WorkflowPreview = WorkflowPreviewImpl;
