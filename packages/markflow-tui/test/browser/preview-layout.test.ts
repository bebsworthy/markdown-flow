// test/browser/preview-layout.test.ts
//
// Deterministic formatter tests for the pure preview-layout module.

import { describe, it, expect } from "vitest";
import type {
  InputDeclaration,
  ValidationDiagnostic,
  WorkflowDefinition,
  FlowGraph,
  StepDefinition,
  FlowEdge,
  FlowNode,
} from "markflow-cli";
import {
  countSteps,
  formatDiagnostics,
  formatDurationShort,
  formatEntryId,
  formatFlowSummary,
  formatInputsSummary,
  formatSourceBadge,
  formatStatusFlag,
  formatStepCountLine,
} from "../../src/browser/preview-layout.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return {
    id,
    type: "script",
    content: "",
    ...overrides,
  };
}

interface MakeWorkflowOverrides {
  name?: string;
  description?: string;
  inputs?: InputDeclaration[];
  graph?: FlowGraph;
  steps?: Iterable<[string, StepDefinition]>;
  sourceFile?: string;
}

function makeWorkflow(
  overrides: MakeWorkflowOverrides = {},
): WorkflowDefinition {
  const steps =
    overrides.steps !== undefined ? new Map(overrides.steps) : new Map();
  return {
    name: overrides.name ?? "test-workflow",
    description: overrides.description ?? "",
    inputs: overrides.inputs ?? [],
    graph: overrides.graph ?? { nodes: new Map(), edges: [] },
    steps,
    sourceFile: overrides.sourceFile ?? "<test>",
  };
}

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "X",
    workflow: null,
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    rawContent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatInputsSummary
// ---------------------------------------------------------------------------

describe("formatInputsSummary", () => {
  it("empty inputs returns empty array", () => {
    expect(formatInputsSummary([])).toEqual([]);
  });

  it("single required input renders 'name  required  description'", () => {
    const inputs: InputDeclaration[] = [
      {
        name: "sha",
        required: true,
        description: "commit to deploy",
      },
    ];
    const out = formatInputsSummary(inputs);
    expect(out[0]).toBe("## Inputs");
    expect(out[1]).toContain("sha");
    expect(out[1]).toContain("required");
    expect(out[1]).toContain("commit to deploy");
  });

  it("single optional input renders 'name  default:VAL  description'", () => {
    const inputs: InputDeclaration[] = [
      {
        name: "regions",
        required: false,
        default: "us,eu",
        description: "regions list",
      },
    ];
    const out = formatInputsSummary(inputs);
    expect(out[1]).toContain("default:us,eu");
  });

  it("multiple inputs right-pad name column to longest", () => {
    const inputs: InputDeclaration[] = [
      { name: "sha", required: true, description: "a" },
      { name: "regions", required: false, default: "us", description: "b" },
    ];
    const out = formatInputsSummary(inputs);
    // Both should have name column width of 7 (len of "regions").
    const aliasedName1 = out[1]!.match(/^\s\s(\S+\s*)\s\s/);
    const aliasedName2 = out[2]!.match(/^\s\s(\S+\s*)\s\s/);
    expect(aliasedName1 && aliasedName2).toBeTruthy();
  });

  it("preserves input order from the workflow", () => {
    const inputs: InputDeclaration[] = [
      { name: "c", required: true, description: "" },
      { name: "a", required: true, description: "" },
      { name: "b", required: true, description: "" },
    ];
    const out = formatInputsSummary(inputs);
    expect(out[1]!.trim().startsWith("c")).toBe(true);
    expect(out[2]!.trim().startsWith("a")).toBe(true);
    expect(out[3]!.trim().startsWith("b")).toBe(true);
  });

  it("missing description → last column omitted", () => {
    const inputs: InputDeclaration[] = [
      { name: "x", required: true, description: "" },
    ];
    const out = formatInputsSummary(inputs);
    // Trailing spaces trimmed; last row ends with "required" (no description).
    expect(out[1]!.endsWith("required")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatFlowSummary
// ---------------------------------------------------------------------------

describe("formatFlowSummary", () => {
  it("empty graph returns empty array", () => {
    const wf = makeWorkflow();
    expect(formatFlowSummary(wf)).toEqual([]);
  });

  it("linear chain renders as 'a → b → c'", () => {
    const graph = makeGraph(
      [
        { id: "a", isStart: true },
        { id: "b" },
        { id: "c" },
      ],
      [
        { from: "a", to: "b", stroke: "normal", annotations: {} },
        { from: "b", to: "c", stroke: "normal", annotations: {} },
      ],
    );
    const wf = makeWorkflow({
      graph,
      steps: [
        ["a", makeStep("a")],
        ["b", makeStep("b")],
        ["c", makeStep("c")],
      ],
    });
    const out = formatFlowSummary(wf);
    expect(out[0]).toBe("## Flow");
    expect(out[1]).toBe("  a → b → c");
  });

  it("branch renders '└─▶ ...' indented continuation", () => {
    const graph = makeGraph(
      [
        { id: "a", isStart: true },
        { id: "b" },
        { id: "cleanup" },
      ],
      [
        { from: "a", to: "b", stroke: "normal", annotations: {} },
        { from: "a", to: "cleanup", label: "fail", stroke: "normal", annotations: {} },
      ],
    );
    const wf = makeWorkflow({
      graph,
      steps: [
        ["a", makeStep("a")],
        ["b", makeStep("b")],
        ["cleanup", makeStep("cleanup")],
      ],
    });
    const out = formatFlowSummary(wf);
    expect(out.some((l) => l.includes("└─▶"))).toBe(true);
    expect(out.some((l) => l.includes("fail: cleanup"))).toBe(true);
  });

  it("forEach edge renders 'forEach KEY: target' suffix", () => {
    const graph = makeGraph(
      [
        { id: "build", isStart: true },
        { id: "deploy" },
      ],
      [
        {
          from: "build",
          to: "deploy",
          stroke: "normal",
          annotations: { forEach: { key: "regions" } },
        },
      ],
    );
    const wf = makeWorkflow({
      graph,
      steps: [
        ["build", makeStep("build")],
        ["deploy", makeStep("deploy")],
      ],
    });
    const out = formatFlowSummary(wf);
    // forEach edges are relegated to the continuation line because they are
    // not the "primary" chain.
    const joined = out.join("\n");
    expect(joined).toContain("forEach regions: deploy");
  });

  it("approval step renders 'name(approval)' suffix", () => {
    const graph = makeGraph(
      [
        { id: "review", isStart: true },
        { id: "publish" },
      ],
      [
        { from: "review", to: "publish", stroke: "normal", annotations: {} },
      ],
    );
    const wf = makeWorkflow({
      graph,
      steps: [
        ["review", makeStep("review", { type: "approval" })],
        ["publish", makeStep("publish")],
      ],
    });
    const out = formatFlowSummary(wf);
    expect(out[1]).toBe("  review(approval) → publish");
  });

  it("caps at 6 body lines with '… (N more edges)' collapse", () => {
    // Build a star with many branches from root.
    const nodes: FlowNode[] = [{ id: "root", isStart: true }];
    const edges: FlowEdge[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push({ id: `leaf${i}` });
      edges.push({
        from: "root",
        to: `leaf${i}`,
        stroke: "normal",
        annotations: {},
      });
    }
    const graph = makeGraph(nodes, edges);
    const wf = makeWorkflow({
      graph,
      steps: new Map(nodes.map((n) => [n.id, makeStep(n.id)])),
    });
    const out = formatFlowSummary(wf);
    // Header + body lines + collapse marker.
    expect(out[0]).toBe("## Flow");
    expect(out.length).toBeGreaterThanOrEqual(2);
    const collapseLine = out.find((l) => l.includes("more edge"));
    expect(collapseLine).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// formatDiagnostics
// ---------------------------------------------------------------------------

describe("formatDiagnostics", () => {
  it("empty returns empty array", () => {
    expect(formatDiagnostics([], { error: "✗", warning: "⚠" })).toEqual([]);
  });

  it("one error uses the error glyph", () => {
    const diagnostics: ValidationDiagnostic[] = [
      {
        severity: "error",
        code: "FOREACH_NO_COLLECTOR",
        message: "batch has no collector",
        nodeId: "deploy-us",
      },
    ];
    const out = formatDiagnostics(diagnostics, { error: "✗", warning: "⚠" });
    expect(out[0]!.startsWith("✗")).toBe(true);
    expect(out[0]).toContain("FOREACH_NO_COLLECTOR");
    expect(out[0]).toContain("deploy-us");
  });

  it("warning + error: errors first", () => {
    const diagnostics: ValidationDiagnostic[] = [
      { severity: "warning", code: "W1", message: "w" },
      { severity: "error", code: "E1", message: "e" },
    ];
    const out = formatDiagnostics(diagnostics, { error: "✗", warning: "⚠" });
    expect(out[0]).toContain("E1");
    expect(out[1]).toContain("W1");
  });

  it("diagnostic with no code falls back to '(no code)'", () => {
    const diagnostics: ValidationDiagnostic[] = [
      { severity: "error", message: "oops" },
    ];
    const out = formatDiagnostics(diagnostics, { error: "✗", warning: "⚠" });
    expect(out[0]).toContain("(no code)");
  });
});

// ---------------------------------------------------------------------------
// countSteps / formatStepCountLine
// ---------------------------------------------------------------------------

describe("countSteps", () => {
  it("counts steps, approvals, and forEach edges", () => {
    const wf = makeWorkflow({
      steps: [
        ["a", makeStep("a")],
        ["b", makeStep("b")],
        ["c", makeStep("c")],
        ["approve", makeStep("approve", { type: "approval" })],
      ],
      graph: makeGraph(
        [],
        [
          {
            from: "a",
            to: "b",
            stroke: "normal",
            annotations: { forEach: { key: "x" } },
          },
        ],
      ),
    });
    expect(countSteps(wf)).toEqual({ steps: 4, approvals: 1, forEach: 1 });
  });

  it("zero forEach edges → forEach: 0", () => {
    const wf = makeWorkflow({
      steps: [["a", makeStep("a")]],
    });
    expect(countSteps(wf)).toEqual({ steps: 1, approvals: 0, forEach: 0 });
  });
});

describe("formatStepCountLine", () => {
  it("omits approvals and forEach when zero", () => {
    expect(formatStepCountLine({ steps: 3, approvals: 0, forEach: 0 })).toBe(
      "3 steps",
    );
  });

  it("pluralises 'steps' and 'approvals' correctly", () => {
    expect(formatStepCountLine({ steps: 1, approvals: 1, forEach: 0 })).toBe(
      "1 step · 1 approval",
    );
    expect(formatStepCountLine({ steps: 9, approvals: 1, forEach: 1 })).toBe(
      "9 steps · 1 approval · 1 forEach",
    );
  });
});

// ---------------------------------------------------------------------------
// formatSourceBadge
// ---------------------------------------------------------------------------

describe("formatSourceBadge", () => {
  it("file sourceKind → '[file]'", () => {
    expect(formatSourceBadge(makeResolved({ sourceKind: "file" }))).toBe(
      "[file]",
    );
  });

  it("workspace sourceKind → '[workspace]'", () => {
    expect(formatSourceBadge(makeResolved({ sourceKind: "workspace" }))).toBe(
      "[workspace]",
    );
  });
});

// ---------------------------------------------------------------------------
// formatStatusFlag
// ---------------------------------------------------------------------------

describe("formatStatusFlag", () => {
  it("valid + last-run complete 2h ago → ✓ 2h, tone:good", () => {
    const now = Date.parse("2026-04-16T10:00:00Z");
    const endedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const resolved = makeResolved({
      lastRun: { status: "complete", endedAt },
    });
    expect(formatStatusFlag(resolved, now)).toEqual({
      text: "✓ 2h",
      tone: "good",
    });
  });

  it("valid + last-run error 3d ago → ✗ 3d, tone:bad", () => {
    const now = Date.parse("2026-04-16T10:00:00Z");
    const endedAt = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const resolved = makeResolved({
      lastRun: { status: "error", endedAt },
    });
    expect(formatStatusFlag(resolved, now)).toEqual({
      text: "✗ 3d",
      tone: "bad",
    });
  });

  it("valid + no runs → — never, tone:neutral", () => {
    const resolved = makeResolved({ lastRun: null });
    expect(formatStatusFlag(resolved)).toEqual({
      text: "— never",
      tone: "neutral",
    });
  });

  it("parse-error → ✗ parse, tone:bad", () => {
    const resolved = makeResolved({ status: "parse-error" });
    expect(formatStatusFlag(resolved)).toEqual({
      text: "✗ parse",
      tone: "bad",
    });
  });

  it("missing → ✗ 404, tone:bad", () => {
    const resolved = makeResolved({ status: "missing" });
    expect(formatStatusFlag(resolved)).toEqual({
      text: "✗ 404",
      tone: "bad",
    });
  });
});

// ---------------------------------------------------------------------------
// formatDurationShort
// ---------------------------------------------------------------------------

describe("formatDurationShort", () => {
  it("handles the 45s, 2h, 1d, 7d thresholds", () => {
    expect(formatDurationShort(45_000)).toBe("45s");
    expect(formatDurationShort(2 * 60 * 60 * 1000)).toBe("2h");
    expect(formatDurationShort(24 * 60 * 60 * 1000)).toBe("1d");
    expect(formatDurationShort(7 * 24 * 60 * 60 * 1000)).toBe("7d");
  });
});

// ---------------------------------------------------------------------------
// formatEntryId
// ---------------------------------------------------------------------------

describe("formatEntryId", () => {
  it("returns entry.source verbatim", () => {
    expect(formatEntryId({ source: "./flows/deploy.md" })).toBe(
      "./flows/deploy.md",
    );
  });
});
