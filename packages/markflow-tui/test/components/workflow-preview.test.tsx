// test/components/workflow-preview.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type {
  FlowEdge,
  FlowGraph,
  FlowNode,
  InputDeclaration,
  StepDefinition,
  ValidationDiagnostic,
  WorkflowDefinition,
} from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowPreview } from "../../src/components/workflow-preview.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeGraph(
  nodes: ReadonlyArray<FlowNode>,
  edges: ReadonlyArray<FlowEdge>,
): FlowGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges: edges.slice(),
  };
}

function makeStep(
  id: string,
  overrides: Partial<StepDefinition> = {},
): StepDefinition {
  return { id, type: "script", content: "", ...overrides };
}

function makeWorkflow(
  overrides: {
    name?: string;
    description?: string;
    inputs?: InputDeclaration[];
    graph?: FlowGraph;
    steps?: Iterable<[string, StepDefinition]>;
  } = {},
): WorkflowDefinition {
  const steps = overrides.steps ? new Map(overrides.steps) : new Map();
  return {
    name: overrides.name ?? "demo",
    description: overrides.description ?? "",
    inputs: overrides.inputs ?? [],
    graph: overrides.graph ?? { nodes: new Map(), edges: [] },
    steps,
    sourceFile: "<test>",
  };
}

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "demo",
    workflow: makeWorkflow(),
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    ...overrides,
  };
}

function renderPreview(props: {
  resolved: ResolvedEntry | null;
  width?: number;
  height?: number;
}): string {
  const { lastFrame } = render(
    <ThemeProvider>
      <WorkflowPreview
        resolved={props.resolved}
        width={props.width ?? 60}
        height={props.height ?? 20}
      />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it("parse-error renders diagnostics block with first 5 + '+N more'", () => {
    const diagnostics: ValidationDiagnostic[] = Array.from(
      { length: 7 },
      (_, i) => ({
        severity: "error" as const,
        code: `E${i}`,
        message: `err ${i}`,
      }),
    );
    const frame = renderPreview({
      resolved: makeResolved({
        status: "parse-error",
        diagnostics,
        errorReason: "parse",
        workflow: null,
      }),
    });
    expect(frame).toContain("E0");
    expect(frame).toContain("E4");
    expect(frame).toContain("+2 more");
    expect(frame).not.toContain("E5");
  });

  it("valid renders '# {name}' header", () => {
    const workflow = makeWorkflow({ name: "deploy-all" });
    const frame = renderPreview({
      resolved: makeResolved({ workflow, title: "deploy-all" }),
    });
    expect(frame).toContain("# deploy-all");
  });

  it("valid renders description after header", () => {
    const workflow = makeWorkflow({
      name: "deploy",
      description: "deploys things to regions",
    });
    const frame = renderPreview({
      resolved: makeResolved({ workflow }),
    });
    expect(frame).toContain("deploys things to regions");
  });

  it("valid renders '## Inputs' block when inputs exist", () => {
    const workflow = makeWorkflow({
      name: "x",
      inputs: [
        { name: "sha", required: true, description: "commit to deploy" },
      ],
    });
    const frame = renderPreview({
      resolved: makeResolved({ workflow }),
    });
    expect(frame).toContain("## Inputs");
    expect(frame).toContain("sha");
    expect(frame).toContain("required");
  });

  it("valid with no inputs omits the '## Inputs' block", () => {
    const workflow = makeWorkflow({ name: "x", inputs: [] });
    const frame = renderPreview({
      resolved: makeResolved({ workflow }),
    });
    expect(frame).not.toContain("## Inputs");
  });

  it("valid renders '## Flow' block with edge summary", () => {
    const graph = makeGraph(
      [{ id: "a", isStart: true }, { id: "b" }],
      [{ from: "a", to: "b", stroke: "normal", annotations: {} }],
    );
    const workflow = makeWorkflow({
      graph,
      steps: [
        ["a", makeStep("a")],
        ["b", makeStep("b")],
      ],
    });
    const frame = renderPreview({
      resolved: makeResolved({ workflow }),
    });
    expect(frame).toContain("## Flow");
    expect(frame).toContain("a → b");
  });

  it("valid renders step-count sentence", () => {
    const workflow = makeWorkflow({
      steps: [
        ["a", makeStep("a")],
        ["b", makeStep("b")],
        ["c", makeStep("c")],
      ],
    });
    const frame = renderPreview({
      resolved: makeResolved({ workflow }),
    });
    expect(frame).toContain("3 steps");
  });

  it("valid with zero diagnostics renders 'diagnostics: ✓ validated'", () => {
    const frame = renderPreview({
      resolved: makeResolved({ diagnostics: [] }),
    });
    expect(frame).toContain("diagnostics:");
    expect(frame).toContain("validated");
  });

  it("valid with warning diagnostics renders the warning lines", () => {
    const diagnostics: ValidationDiagnostic[] = [
      {
        severity: "warning",
        code: "UNREACHABLE",
        message: "cleanup: no incoming edges",
        nodeId: "cleanup",
      },
    ];
    const frame = renderPreview({
      resolved: makeResolved({ diagnostics }),
    });
    expect(frame).toContain("UNREACHABLE");
    expect(frame).toContain("cleanup");
  });
});
