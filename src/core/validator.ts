import type {
  WorkflowDefinition,
  ValidationDiagnostic,
  FlowEdge,
} from "./types.js";

export function validateWorkflow(
  def: WorkflowDefinition,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const { graph, steps } = def;

  // 1. All node IDs in the graph must have a matching step
  for (const nodeId of graph.nodes.keys()) {
    if (!steps.has(nodeId)) {
      diagnostics.push({
        severity: "error",
        message: `Node "${nodeId}" is referenced in the flow but has no ## step definition`,
        nodeId,
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
      });
    }
  }

  // 3. Retry handler completeness
  const edgesBySource = groupEdgesBySource(graph.edges);
  for (const [nodeId, edges] of edgesBySource) {
    const retryEdges = edges.filter(
      (e) => e.annotations.maxRetries !== undefined,
    );
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
        });
      }
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
