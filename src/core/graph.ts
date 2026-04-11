import type { FlowGraph, FlowEdge } from "./types.js";

export function getOutgoingEdges(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function getIncomingEdges(graph: FlowGraph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

/** Nodes with no incoming edges — entry points of the workflow. */
export function getStartNodes(graph: FlowGraph): string[] {
  const targets = new Set(graph.edges.map((e) => e.to));
  return [...graph.nodes.keys()].filter((id) => !targets.has(id));
}

/** Nodes with no outgoing edges — terminal nodes. */
export function getTerminalNodes(graph: FlowGraph): string[] {
  const sources = new Set(graph.edges.map((e) => e.from));
  return [...graph.nodes.keys()].filter((id) => !sources.has(id));
}

/** True if a node has multiple incoming edges from distinct sources. */
export function isMergeNode(graph: FlowGraph, nodeId: string): boolean {
  const incoming = getIncomingEdges(graph, nodeId);
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
