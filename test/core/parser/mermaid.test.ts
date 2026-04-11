import { describe, it, expect } from "vitest";
import { parseMermaidFlowchart } from "../../../src/core/parser/mermaid.js";

describe("parseMermaidFlowchart", () => {
  it("parses simple edges", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A --> B
  B --> C`);
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "A", to: "B" });
    expect(graph.edges[1]).toMatchObject({ from: "B", to: "C" });
  });

  it("parses labelled edges", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A -->|pass| B
  A -->|fail| C`);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "A", to: "B", label: "pass" });
    expect(graph.edges[1]).toMatchObject({ from: "A", to: "C", label: "fail" });
  });

  it("parses max:N annotation", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  test -->|fail max:3| fix`);
    expect(graph.edges[0].label).toBe("fail");
    expect(graph.edges[0].annotations.maxRetries).toBe(3);
  });

  it("parses :max exhaustion handler", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  test -->|fail:max| abort`);
    expect(graph.edges[0].annotations.isExhaustionHandler).toBe(true);
    expect(graph.edges[0].annotations.exhaustionLabel).toBe("fail");
  });

  it("parses node labels", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  start[Start Here] --> finish[Done]`);
    expect(graph.nodes.get("start")?.label).toBe("Start Here");
    expect(graph.nodes.get("finish")?.label).toBe("Done");
  });

  it("handles multiple directions", () => {
    for (const dir of ["TD", "LR", "TB", "BT", "RL"]) {
      const graph = parseMermaidFlowchart(`flowchart ${dir}\n  A --> B`);
      expect(graph.edges).toHaveLength(1);
    }
  });

  it("ignores comments", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  %% This is a comment
  A --> B`);
    expect(graph.edges).toHaveLength(1);
  });

  it("throws on invalid diagram type", () => {
    expect(() => parseMermaidFlowchart("sequence\n  A -> B")).toThrow();
  });

  it("handles complex retry scenario", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  test -->|pass| deploy
  test -->|fail max:3| fix
  test -->|fail:max| abort
  fix --> test`);

    expect(graph.nodes.size).toBe(4);
    expect(graph.edges).toHaveLength(4);

    const retryEdge = graph.edges.find((e) => e.annotations.maxRetries === 3);
    expect(retryEdge).toBeDefined();
    expect(retryEdge!.from).toBe("test");
    expect(retryEdge!.to).toBe("fix");

    const exhaustionEdge = graph.edges.find(
      (e) => e.annotations.isExhaustionHandler,
    );
    expect(exhaustionEdge).toBeDefined();
    expect(exhaustionEdge!.to).toBe("abort");
  });
});
