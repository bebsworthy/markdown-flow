import { describe, it, expect } from "vitest";
import {
  getTerminalNodes,
  getUpstreamNodes,
  isMergeNode,
  tokensByBatch,
} from "../../src/core/index.js";

describe("public API surface — P1-T1", () => {
  it("exports graph helpers and tokensByBatch", () => {
    expect(typeof getTerminalNodes).toBe("function");
    expect(typeof getUpstreamNodes).toBe("function");
    expect(typeof isMergeNode).toBe("function");
    expect(typeof tokensByBatch).toBe("function");

    const emptyGraph = { nodes: new Map(), edges: [] };
    expect(getTerminalNodes(emptyGraph)).toEqual([]);
    expect(getUpstreamNodes(emptyGraph, "x")).toEqual([]);
    expect(isMergeNode(emptyGraph, "x")).toBe(false);

    const emptySnap = {
      tokens: new Map(),
      retryBudgets: new Map(),
      globalContext: {},
      completedResults: [],
      status: "running" as const,
      batches: new Map(),
    };
    expect(tokensByBatch(emptySnap, "any")).toEqual([]);
  });
});
