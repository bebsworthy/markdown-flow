import type {
  WorkflowDefinition,
  ValidationDiagnostic,
  FlowEdge,
} from "./types.js";
import { getStartNodes, getOutgoingEdges } from "./graph.js";

export function validateWorkflow(
  def: WorkflowDefinition,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [
    ...(def.parserDiagnostics ?? []),
  ];
  const { graph, steps } = def;
  const source = def.sourceFile;

  // 1. All node IDs in the graph must have a matching step
  for (const nodeId of graph.nodes.keys()) {
    if (!steps.has(nodeId)) {
      diagnostics.push({
        severity: "error",
        message: `Node "${nodeId}" is referenced in the flow but has no ## step definition`,
        nodeId,
        source,
        suggestion: `Add a "## ${nodeId}" section under # Steps`,
      });
    }
  }

  // 2. All steps should be referenced in the graph (warning only)
  for (const stepId of steps.keys()) {
    if (!graph.nodes.has(stepId)) {
      diagnostics.push({
        severity: "warning",
        message: `Step "${stepId}" is defined but not referenced in the flow`,
        nodeId: stepId,
        line: steps.get(stepId)?.line,
        source,
        suggestion: "Remove the unused step or add it to the mermaid flowchart",
      });
    }
  }

  // 3. Retry handler completeness
  const edgesBySource = groupEdgesBySource(graph.edges);
  for (const [nodeId, edges] of edgesBySource) {
    const retryEdges = edges.filter(
      (e) => e.annotations.maxRetries !== undefined,
    );

    // Warn if the step declares an intrinsic retry policy AND the node has
    // edge-level retry annotations. Step policy wins at runtime.
    const step = steps.get(nodeId);
    if (step?.stepConfig?.retry && retryEdges.length > 0) {
      const edgeLabels = retryEdges.map((e) => `${e.label} max:${e.annotations.maxRetries}`).join(", ");
      diagnostics.push({
        severity: "warning",
        message: `Step "${nodeId}" has both a \`retry\` config block and edge-level retry annotations (${edgeLabels}). The step policy will be used; edge \`max:N\` is ignored.`,
        nodeId,
        line: step.line,
        source,
        suggestion: "Remove the edge-level `max:N` annotation, or remove the step's `retry` config.",
      });
    }
    const exhaustionEdges = edges.filter(
      (e) => e.annotations.isExhaustionHandler,
    );

    for (const retryEdge of retryEdges) {
      const label = retryEdge.label;
      const hasHandler = exhaustionEdges.some(
        (e) => e.annotations.exhaustionLabel === label,
      );
      if (!hasHandler) {
        diagnostics.push({
          severity: "error",
          message: `Edge "${label} max:${retryEdge.annotations.maxRetries}" from "${nodeId}" has no corresponding "${label}:max" handler`,
          nodeId,
          source,
          suggestion: `Add an edge "${label}:max" from "${nodeId}" to handle retry exhaustion`,
        });
      }
    }

    for (const exhEdge of exhaustionEdges) {
      const baseLabel = exhEdge.annotations.exhaustionLabel;
      const hasRetry = retryEdges.some((e) => e.label === baseLabel);
      if (!hasRetry) {
        diagnostics.push({
          severity: "error",
          message: `Exhaustion handler "${baseLabel}:max" from "${nodeId}" has no corresponding "${baseLabel} max:N" edge`,
          nodeId,
          source,
          suggestion: `Add an edge "${baseLabel} max:N" from "${nodeId}" to set a retry limit`,
        });
      }
    }
  }

  // 4. No duplicate labelled edges from the same node (excluding :max handlers)
  // Unlabelled edges to different targets are valid fan-out
  for (const [nodeId, edges] of edgesBySource) {
    const nonExhaustionEdges = edges.filter(
      (e) => !e.annotations.isExhaustionHandler,
    );
    const labelledEdges = nonExhaustionEdges.filter((e) => e.label);
    const labelCounts = new Map<string, number>();
    for (const edge of labelledEdges) {
      labelCounts.set(edge.label!, (labelCounts.get(edge.label!) ?? 0) + 1);
    }
    for (const [label, count] of labelCounts) {
      if (count > 1) {
        diagnostics.push({
          severity: "error",
          message: `Node "${nodeId}" has ${count} outgoing edges with "${label}" label`,
          nodeId,
          source,
        });
      }
    }
  }

  // 5. Exactly one start node
  const startNodes = getStartNodes(graph);
  if (graph.nodes.size > 0 && startNodes.length === 0) {
    diagnostics.push({
      severity: "error",
      message:
        "Workflow has no start node. Mark the entry node with Mermaid stadium shape (e.g. `emit([Emit next issue])`), or ensure at least one node has no incoming edges.",
      source,
    });
  } else if (startNodes.length > 1) {
    diagnostics.push({
      severity: "error",
      message: `Workflow has ${startNodes.length} start nodes (${startNodes.join(", ")}). Only one entry point is allowed — use a single start node that fans out explicitly.`,
      source,
      suggestion: "Add a single start node with unlabelled edges to each parallel branch",
    });
  }

  // 6. Mixed labelled/unlabelled edges from the same node
  for (const [nodeId, edges] of edgesBySource) {
    const nonExhaustion = edges.filter(
      (e) => !e.annotations.isExhaustionHandler,
    );
    if (nonExhaustion.length < 2) continue;
    const hasLabelled = nonExhaustion.some((e) => e.label);
    const hasUnlabelled = nonExhaustion.some((e) => !e.label);
    if (hasLabelled && hasUnlabelled) {
      diagnostics.push({
        severity: "warning",
        message: `Node "${nodeId}" has both labelled and unlabelled outgoing edges — the unlabelled edge acts as an implicit catch-all`,
        nodeId,
        source,
        suggestion: "Label all outgoing edges from this node for explicit routing",
      });
    }
  }

  // 7. Unreachable nodes (BFS from start nodes)
  if (startNodes.length > 0) {
    const visited = new Set<string>();
    const queue = [...startNodes];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of getOutgoingEdges(graph, current)) {
        if (!visited.has(edge.to)) queue.push(edge.to);
      }
    }
    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        diagnostics.push({
          severity: "warning",
          message: `Node "${nodeId}" is unreachable from any start node`,
          nodeId,
          source,
          suggestion: "Connect it to the graph or remove it from the flowchart",
        });
      }
    }
  }

  // 8. Duplicate input names
  const seenInputs = new Map<string, number>();
  for (let i = 0; i < def.inputs.length; i++) {
    const input = def.inputs[i];
    const prev = seenInputs.get(input.name);
    if (prev !== undefined) {
      diagnostics.push({
        severity: "error",
        message: `Input "${input.name}" is declared more than once`,
        source,
      });
    } else {
      seenInputs.set(input.name, i);
    }
  }

  return diagnostics;
}

function groupEdgesBySource(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const map = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (!map.has(edge.from)) {
      map.set(edge.from, []);
    }
    map.get(edge.from)!.push(edge);
  }
  return map;
}
