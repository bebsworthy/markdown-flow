import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflowFromString } from "../../src/core/index.js";
import {
  getStartNodes,
  getTerminalNodes,
  isMergeNode,
  getUpstreamNodes,
  getFanOutTargets,
} from "../../src/core/graph.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("graph utilities", () => {
  it("finds start nodes in linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(getStartNodes(def.graph)).toEqual(["setup"]);
  });

  it("finds terminal nodes in linear workflow", () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(getTerminalNodes(def.graph)).toEqual(["report"]);
  });

  it("detects merge nodes in parallel workflow", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    expect(isMergeNode(def.graph, "merge")).toBe(true);
    expect(isMergeNode(def.graph, "lint")).toBe(false);
  });

  it("finds upstream nodes", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const upstreams = getUpstreamNodes(def.graph, "merge");
    expect(upstreams).toContain("lint");
    expect(upstreams).toContain("test");
    expect(upstreams).toContain("typecheck");
  });

  it("detects fan-out targets", () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const targets = getFanOutTargets(def.graph, "start");
    expect(targets).toContain("lint");
    expect(targets).toContain("test");
    expect(targets).toContain("typecheck");
    expect(targets).toHaveLength(3);
  });
});
