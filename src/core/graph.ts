import type { FlowGraph, FlowEdge } from "./types.js";

export function getOutgoingEdges(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function getIncomingEdges(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

/**
 * Entry points of the workflow. Nodes explicitly marked with Mermaid's
 * stadium shape (`id([Label])`) take precedence — required for cyclic
 * graphs where every node has an incoming edge. Falls back to nodes with
 * no incoming edges for acyclic workflows.
 */
export function getStartNodes(graph: FlowGraph): string[] {
  const explicit = [...graph.nodes.values()]
    .filter((n) => n.isStart)
    .map((n) => n.id);
  if (explicit.length > 0) return explicit;

  const targets = new Set(graph.edges.map((e) => e.to));
  return [...graph.nodes.keys()].filter((id) => !targets.has(id));
}

/** Nodes with no outgoing edges — terminal nodes. */
export function getTerminalNodes(graph: FlowGraph): string[] {
  const sources = new Set(graph.edges.map((e) => e.from));
  return [...graph.nodes.keys()].filter((id) => !sources.has(id));
}

/**
 * True if a node is a parallel fan-in (and-join) — i.e. it has multiple
 * incoming edges from distinct sources AND all those edges are unlabeled.
 *
 * Labeled edges indicate conditional routing (or-join): any one token fires
 * the node immediately. Only unlabeled edges represent parallel branches that
 * must all complete before the node is ready.
 */
export function isMergeNode(graph: FlowGraph, nodeId: string): boolean {
  const incoming = getIncomingEdges(graph, nodeId);
  if (incoming.length < 2) return false;
  const allUnlabeled = incoming.every((e) => !e.label);
  if (!allUnlabeled) return false;
  const uniqueSources = new Set(incoming.map((e) => e.from));
  return uniqueSources.size > 1;
}

/** Direct predecessor node IDs. */
export function getUpstreamNodes(graph: FlowGraph, nodeId: string): string[] {
  const incoming = getIncomingEdges(graph, nodeId);
  return [...new Set(incoming.map((e) => e.from))];
}

/**
 * For fan-out detection: returns the set of distinct target node IDs
 * from outgoing edges of a node. If multiple targets exist with no
 * label conflicts, they can run in parallel.
 */
export function getFanOutTargets(
  graph: FlowGraph,
  nodeId: string,
): string[] {
  const outgoing = getOutgoingEdges(graph, nodeId);
  return [...new Set(outgoing.map((e) => e.to))];
}

export interface ForEachScope {
  key: string;
  bodyNodes: string[];
  collectorNode: string;
}

/**
 * Given a node with an outgoing thick `each:` edge, trace the `==>` chain
 * and return the forEach scope: item key, body nodes, and collector node.
 *
 * Returns `undefined` if the node has no outgoing forEach edge.
 */
export function getForEachScope(
  graph: FlowGraph,
  nodeId: string,
): ForEachScope | undefined {
  const outgoing = getOutgoingEdges(graph, nodeId);
  const forEachEdge = outgoing.find(
    (e) => e.stroke === "thick" && e.annotations.forEach,
  );
  if (!forEachEdge) return undefined;

  const key = forEachEdge.annotations.forEach!.key;
  const bodyNodes: string[] = [];
  let current = forEachEdge.to;

  while (true) {
    bodyNodes.push(current);
    const next = getOutgoingEdges(graph, current);
    const thickNext = next.find((e) => e.stroke === "thick");
    if (thickNext) {
      current = thickNext.to;
    } else {
      const normalNext = next.find((e) => e.stroke === "normal" || !e.stroke);
      if (!normalNext) break;
      return { key, bodyNodes, collectorNode: normalNext.to };
    }
  }

  return undefined;
}

/**
 * True if a node is a forEach collector — the first normal-edge target
 * after a thick-edge chain originating from a forEach source.
 */
export function isForEachCollector(graph: FlowGraph, nodeId: string): boolean {
  for (const node of graph.nodes.values()) {
    const scope = getForEachScope(graph, node.id);
    if (scope && scope.collectorNode === nodeId) return true;
  }
  return false;
}

/**
 * Find the forEach source node whose scope covers the given body node.
 */
export function findForEachSource(
  graph: FlowGraph,
  bodyNodeId: string,
): { sourceNodeId: string; scope: ForEachScope } | undefined {
  for (const node of graph.nodes.values()) {
    const scope = getForEachScope(graph, node.id);
    if (scope && scope.bodyNodes.includes(bodyNodeId)) {
      return { sourceNodeId: node.id, scope };
    }
  }
  return undefined;
}
