import { describe, it, expect } from "vitest";
import {
  resolveRoute,
  createRetryState,
  incrementRetry,
} from "../../src/core/router.js";
import { DEFAULT_CONFIG } from "../../src/core/config.js";
import type { FlowGraph, StepResult } from "../../src/core/types.js";

function makeResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: "test",
    type: "script",
    edge: "pass",
    summary: "",
    started_at: "",
    completed_at: "",
    exit_code: 0,
    ...overrides,
  };
}

describe("resolveRoute", () => {
  it("follows single outgoing edge regardless of label", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
      ]),
      edges: [{ from: "A", to: "B", label: "next", annotations: {} }],
    };
    const result = makeResult({ node: "A", edge: "whatever" });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets).toHaveLength(1);
    expect(decision.targets[0].nodeId).toBe("B");
  });

  it("matches edge by label", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "pass", annotations: {} },
        { from: "A", to: "C", label: "fail", annotations: {} },
      ],
    };
    const result = makeResult({ node: "A", edge: "fail" });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets[0].nodeId).toBe("C");
  });

  it("treats `next` as a synonym for `pass` / `ok` / `success` / `done`", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "pass", annotations: {} },
        { from: "A", to: "C", label: "fail", annotations: {} },
      ],
    };
    const result = makeResult({ node: "A", edge: "next", exit_code: 0 });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets[0].nodeId).toBe("B");
  });

  it("treats `error` as a synonym for `fail` / `retry`", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "pass", annotations: {} },
        { from: "A", to: "C", label: "fail", annotations: {} },
      ],
    };
    const result = makeResult({ node: "A", edge: "error", exit_code: 1 });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets[0].nodeId).toBe("C");
  });

  it("falls back to unlabelled edge as catch-all when no label matches", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "classified", annotations: {} },
        { from: "A", to: "C", annotations: {} }, // unlabelled catch-all
      ],
    };
    const result = makeResult({ node: "A", edge: "anything-else" });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets[0].nodeId).toBe("C");
  });

  it("prefers exact label match over unlabelled catch-all", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "classified", annotations: {} },
        { from: "A", to: "C", annotations: {} },
      ],
    };
    const result = makeResult({ node: "A", edge: "classified" });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets[0].nodeId).toBe("B");
  });

  it("respects retry budget and follows exhaustion handler", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["test", { id: "test" }],
        ["fix", { id: "fix" }],
        ["abort", { id: "abort" }],
      ]),
      edges: [
        {
          from: "test",
          to: "fix",
          label: "fail",
          annotations: { maxRetries: 2 },
        },
        {
          from: "test",
          to: "abort",
          label: "fail:max",
          annotations: {
            isExhaustionHandler: true,
            exhaustionLabel: "fail",
          },
        },
      ],
    };

    const retryState = createRetryState();
    const failResult = makeResult({ node: "test", edge: "fail" });

    // resolveRoute is now a pure decision function; the caller (engine)
    // applies `incrementRetry` inside write-ahead event emission. Simulate
    // that here so the budget actually advances between calls.
    let d1 = resolveRoute(graph, "test", failResult, retryState, DEFAULT_CONFIG);
    expect(d1.targets[0].nodeId).toBe("fix");
    expect(d1.exhausted).toBe(false);
    incrementRetry(retryState, "test", d1.retryIncrement!.label);

    let d2 = resolveRoute(graph, "test", failResult, retryState, DEFAULT_CONFIG);
    expect(d2.targets[0].nodeId).toBe("fix");
    expect(d2.exhausted).toBe(false);
    incrementRetry(retryState, "test", d2.retryIncrement!.label);

    // Third retry should exhaust and go to abort
    let d3 = resolveRoute(graph, "test", failResult, retryState, DEFAULT_CONFIG);
    expect(d3.targets[0].nodeId).toBe("abort");
    expect(d3.exhausted).toBe(true);
  });

  it("returns empty targets for terminal nodes", () => {
    const graph: FlowGraph = {
      nodes: new Map([["A", { id: "A" }]]),
      edges: [],
    };
    const result = makeResult({ node: "A" });
    const decision = resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG);
    expect(decision.targets).toHaveLength(0);
  });

  it("throws on no matching edge", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "pass", annotations: {} },
        { from: "A", to: "C", label: "ok", annotations: {} },
      ],
    };
    // Agent step with non-matching edge and no exit code fallback
    const result = makeResult({
      node: "A",
      type: "agent",
      edge: "unknown",
      exit_code: null,
    });
    expect(() =>
      resolveRoute(graph, "A", result, createRetryState(), DEFAULT_CONFIG),
    ).toThrow("Routing error");
  });

  // Protects against: exhausted budget without a :max handler causing silent misrouting
  it("throws when retry budget is exhausted and no :max handler exists", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
      ]),
      edges: [
        {
          from: "A",
          to: "B",
          label: "fail",
          annotations: { maxRetries: 1 },
        },
      ],
    };
    const retryState = createRetryState();
    const failResult = makeResult({ node: "A", edge: "fail" });

    // First call: within budget
    const d1 = resolveRoute(graph, "A", failResult, retryState, DEFAULT_CONFIG);
    expect(d1.targets[0].nodeId).toBe("B");
    incrementRetry(retryState, "A", d1.retryIncrement!.label);

    // Second call: budget exhausted, no handler
    expect(() =>
      resolveRoute(graph, "A", failResult, retryState, DEFAULT_CONFIG),
    ).toThrow(/Retry budget exhausted/);
  });

  // Protects against: fan-out producing duplicate targets or missing parallel paths
  it("fan-out follows all unlabelled edges to distinct targets", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", annotations: {} },
        { from: "A", to: "C", annotations: {} },
      ],
    };
    const result = makeResult({ node: "A" });
    const decision = resolveRoute(
      graph,
      "A",
      result,
      createRetryState(),
      DEFAULT_CONFIG,
    );
    expect(decision.targets).toHaveLength(2);
    expect(decision.targets.map((t) => t.nodeId).sort()).toEqual(["B", "C"]);
  });
});

describe("resolveRoute — maxRetriesDefault", () => {
  const configWithDefault = { ...DEFAULT_CONFIG, maxRetriesDefault: 2 };

  function retryGraph(): FlowGraph {
    return {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "fail", annotations: {} },
        {
          from: "A",
          to: "C",
          label: "fail:max",
          annotations: { isExhaustionHandler: true, exhaustionLabel: "fail" },
        },
      ],
    };
  }

  it("applies default retry budget to fail edge when :max handler exists", () => {
    const retry = createRetryState();
    const result = makeResult({ node: "A", edge: "fail", exit_code: 1 });

    const d1 = resolveRoute(retryGraph(), "A", result, retry, configWithDefault);
    expect(d1.targets[0].nodeId).toBe("B");
    expect(d1.retryIncrement).toEqual({ label: "fail", count: 1, max: 2 });
    incrementRetry(retry, "A", d1.retryIncrement!.label);

    const d2 = resolveRoute(retryGraph(), "A", result, retry, configWithDefault);
    expect(d2.retryIncrement).toEqual({ label: "fail", count: 2, max: 2 });
    incrementRetry(retry, "A", d2.retryIncrement!.label);

    const d3 = resolveRoute(retryGraph(), "A", result, retry, configWithDefault);
    expect(d3.exhausted).toBe(true);
    expect(d3.targets[0].nodeId).toBe("C");
  });

  it("explicit max:N on the edge overrides maxRetriesDefault", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "fail", annotations: { maxRetries: 5 } },
        {
          from: "A",
          to: "C",
          label: "fail:max",
          annotations: { isExhaustionHandler: true, exhaustionLabel: "fail" },
        },
      ],
    };
    const result = makeResult({ node: "A", edge: "fail", exit_code: 1 });
    const d = resolveRoute(graph, "A", result, createRetryState(), configWithDefault);
    expect(d.retryIncrement?.max).toBe(5);
  });

  it("default does not apply to success-group labels", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
        ["C", { id: "C" }],
      ]),
      edges: [
        { from: "A", to: "B", label: "pass", annotations: {} },
        {
          from: "A",
          to: "C",
          label: "pass:max",
          annotations: { isExhaustionHandler: true, exhaustionLabel: "pass" },
        },
      ],
    };
    const result = makeResult({ node: "A", edge: "pass" });
    const d = resolveRoute(graph, "A", result, createRetryState(), configWithDefault);
    expect(d.retryIncrement).toBeUndefined();
  });

  it("default is ignored when no :max handler exists", () => {
    const graph: FlowGraph = {
      nodes: new Map([
        ["A", { id: "A" }],
        ["B", { id: "B" }],
      ]),
      edges: [{ from: "A", to: "B", label: "fail", annotations: {} }],
    };
    const result = makeResult({ node: "A", edge: "fail", exit_code: 1 });
    const d = resolveRoute(graph, "A", result, createRetryState(), configWithDefault);
    expect(d.retryIncrement).toBeUndefined();
    expect(d.targets[0].nodeId).toBe("B");
  });
});
