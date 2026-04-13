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

  it("parses stadium shape as start node marker", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  emit([Emit next]) -->|next| check
  check --> emit`);
    const emit = graph.nodes.get("emit");
    expect(emit?.isStart).toBe(true);
    expect(emit?.label).toBe("Emit next");
    expect(graph.nodes.get("check")?.isStart).toBeUndefined();
  });

  it("stadium shape sticks when node re-appears plain", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  emit([Start]) --> check
  check --> emit`);
    expect(graph.nodes.get("emit")?.isStart).toBe(true);
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

  // ── New: node shapes ──────────────────────────────────────────────────

  it("parses all common node shapes", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A[Square] --> B(Round)
  B --> C{Diamond}
  C --> D((Circle))
  D --> E[(Cylinder)]
  E --> F[[Subroutine]]
  F --> G>Asymmetric]
  G --> H{{Hexagon}}`);

    expect(graph.nodes.get("A")?.shape).toBe("square");
    expect(graph.nodes.get("B")?.shape).toBe("round");
    expect(graph.nodes.get("C")?.shape).toBe("diamond");
    expect(graph.nodes.get("D")?.shape).toBe("circle");
    expect(graph.nodes.get("E")?.shape).toBe("cylinder");
    expect(graph.nodes.get("F")?.shape).toBe("subroutine");
    expect(graph.nodes.get("G")?.shape).toBe("odd");
    expect(graph.nodes.get("H")?.shape).toBe("hexagon");
  });

  it("parses parallelogram and trapezoid shapes", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A[/Lean Right/] --> B[\\Lean Left\\]
  B --> C[/Trapezoid\\]
  C --> D[\\Inv Trapezoid/]`);

    expect(graph.nodes.get("A")?.shape).toBe("lean_right");
    expect(graph.nodes.get("B")?.shape).toBe("lean_left");
    expect(graph.nodes.get("C")?.shape).toBe("trapezoid");
    expect(graph.nodes.get("D")?.shape).toBe("inv_trapezoid");
  });

  it("sets isStart only for stadium shape", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A([Stadium]) --> B{Diamond}
  B --> C((Circle))`);

    expect(graph.nodes.get("A")?.isStart).toBe(true);
    expect(graph.nodes.get("B")?.isStart).toBeUndefined();
    expect(graph.nodes.get("C")?.isStart).toBeUndefined();
  });

  // ── New: edge types ───────────────────────────────────────────────────

  it("parses dotted edges", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A -.-> B
  B -.->|optional| C`);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "A", to: "B" });
    expect(graph.edges[1]).toMatchObject({ from: "B", to: "C", label: "optional" });
  });

  it("parses thick edges", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A ==> B
  B ==>|important| C`);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "A", to: "B" });
    expect(graph.edges[1]).toMatchObject({ from: "B", to: "C", label: "important" });
  });

  it("parses open (no arrow) edges", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A --- B
  B ---|link| C`);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "A", to: "B" });
    expect(graph.edges[1]).toMatchObject({ from: "B", to: "C", label: "link" });
  });

  // ── New: subgraphs ────────────────────────────────────────────────────

  it("includes subgraph nodes in the graph", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  subgraph Build
    lint --> test
    test --> typecheck
  end
  setup --> lint
  typecheck --> deploy`);

    expect(graph.nodes.has("lint")).toBe(true);
    expect(graph.nodes.has("test")).toBe(true);
    expect(graph.nodes.has("typecheck")).toBe(true);
    expect(graph.nodes.has("setup")).toBe(true);
    expect(graph.nodes.has("deploy")).toBe(true);
    expect(graph.edges).toHaveLength(4);
  });

  // ── New: labels and text ──────────────────────────────────────────────

  it("parses quoted multi-word labels", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A["Long label with spaces"] --> B["Another label"]`);

    expect(graph.nodes.get("A")?.label).toBe("Long label with spaces");
    expect(graph.nodes.get("B")?.label).toBe("Another label");
  });

  it("parses standalone node declarations", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A[Declared]
  A --> B`);

    expect(graph.nodes.get("A")?.label).toBe("Declared");
    expect(graph.edges).toHaveLength(1);
  });

  it("supports graph keyword as alias for flowchart", () => {
    const graph = parseMermaidFlowchart(`graph TD
  A --> B`);

    expect(graph.nodes.size).toBe(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("handles double-circle shape", () => {
    const graph = parseMermaidFlowchart(`flowchart TD
  A(((Double Circle))) --> B`);

    expect(graph.nodes.get("A")?.shape).toBe("doublecircle");
    expect(graph.nodes.get("A")?.label).toBe("Double Circle");
  });
});
