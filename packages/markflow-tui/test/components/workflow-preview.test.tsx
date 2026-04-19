// test/components/workflow-preview.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowPreview } from "../../src/components/workflow-preview.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "demo",
    workflow: {
      name: "demo",
      description: "",
      inputs: [],
      graph: { nodes: new Map(), edges: [] },
      steps: new Map(),
      sourceFile: "/abs/x.md",
    },
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    rawContent: null,
    ...overrides,
  };
}

function renderPreview(props: {
  resolved: ResolvedEntry | null;
  width?: number;
  height?: number;
  codeBlocksCollapsed?: boolean;
}): string {
  const { lastFrame } = render(
    <ThemeProvider>
      <WorkflowPreview
        resolved={props.resolved}
        width={props.width ?? 60}
        height={props.height ?? 20}
        codeBlocksCollapsed={props.codeBlocksCollapsed ?? false}
      />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

const SAMPLE_MD = `# Deploy

Deploy to production.

# Flow

\`\`\`mermaid
flowchart TD
  build --> test
\`\`\`

# Steps

## build

\`\`\`bash
echo "building"
\`\`\`

## test

\`\`\`bash
echo "testing"
\`\`\`
`;

describe("WorkflowPreview", () => {
  it("resolved=null renders 'Select a workflow to preview'", () => {
    const frame = renderPreview({ resolved: null });
    expect(frame).toContain("Select a workflow to preview");
  });

  it("missing renders error banner + raw source", () => {
    const frame = renderPreview({
      resolved: makeResolved({
        status: "missing",
        errorReason: "404",
        workflow: null,
      }),
    });
    expect(frame).toContain("404");
    expect(frame).toContain("./x.md");
  });

  it("null rawContent renders '(no content)' with source path", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: null }),
    });
    expect(frame).toContain("/abs/x.md");
    expect(frame).toContain("(no content)");
  });

  it("renders source path at the top", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
    });
    expect(frame).toContain("/abs/x.md");
  });

  it("renders markdown headers as bold text", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
    });
    expect(frame).toContain("# Deploy");
    expect(frame).toContain("# Steps");
  });

  it("renders prose lines", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
    });
    expect(frame).toContain("Deploy to production.");
  });

  it("renders code blocks expanded when codeBlocksCollapsed=false", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
      codeBlocksCollapsed: false,
    });
    expect(frame).toContain("```bash");
    expect(frame).toContain("building");
  });

  it("renders code blocks collapsed when codeBlocksCollapsed=true", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
      codeBlocksCollapsed: true,
    });
    expect(frame).toMatch(/```mermaid.*\(2 lines\)/);
    expect(frame).not.toContain("flowchart TD");
    expect(frame).toMatch(/```bash.*\(1 line\)/);
    expect(frame).not.toContain("building");
  });

  it("renders step headers within markdown", () => {
    const frame = renderPreview({
      resolved: makeResolved({ rawContent: SAMPLE_MD }),
      height: 40,
    });
    expect(frame).toContain("## build");
    expect(frame).toContain("## test");
  });
});
