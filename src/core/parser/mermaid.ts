import type { FlowGraph, FlowNode, FlowEdge, EdgeAnnotations } from "../types.js";

/**
 * Parse a Mermaid flowchart string into a FlowGraph.
 * Only supports the `flowchart` diagram type with `-->` edges.
 */
export function parseMermaidFlowchart(source: string): FlowGraph {
  const lines = source.split("\n").map((l) => l.trim());
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  const firstLine = lines.find((l) => l.length > 0 && !l.startsWith("%%"));
  if (!firstLine || !/^flowchart\s+(TD|TB|LR|RL|BT)/i.test(firstLine)) {
    throw new Error(
      'Mermaid block must start with "flowchart" and a direction (TD, LR, etc.)',
    );
  }

  // Regex for edges: nodeA --> nodeB, nodeA -->|label| nodeB
  // Node IDs can contain word chars and hyphens
  const edgeRegex =
    /^([\w-]+)(?:\[([^\]]*)\])?\s*-->\s*(?:\|([^|]*)\|\s*)?([\w-]+)(?:\[([^\]]*)\])?$/;

  // Regex for standalone node declarations: nodeId[Label text]
  const nodeRegex = /^([\w-]+)\[([^\]]*)\]$/;

  for (const line of lines) {
    if (
      line.length === 0 ||
      line.startsWith("%%") ||
      /^flowchart\s+/i.test(line)
    ) {
      continue;
    }

    const edgeMatch = line.match(edgeRegex);
    if (edgeMatch) {
      const [, fromId, fromLabel, rawLabel, toId, toLabel] = edgeMatch;

      ensureNode(nodes, fromId, fromLabel);
      ensureNode(nodes, toId, toLabel);

      const { label, annotations } = parseEdgeLabel(rawLabel);
      edges.push({ from: fromId, to: toId, label, annotations });
      continue;
    }

    const nodeMatch = line.match(nodeRegex);
    if (nodeMatch) {
      const [, id, label] = nodeMatch;
      ensureNode(nodes, id, label);
      continue;
    }

    // Ignore lines we don't understand (subgraph, style, etc.)
  }

  return { nodes, edges };
}

function ensureNode(
  nodes: Map<string, FlowNode>,
  id: string,
  label?: string,
): void {
  if (!nodes.has(id)) {
    nodes.set(id, { id, label: label || undefined });
  } else if (label && !nodes.get(id)!.label) {
    nodes.get(id)!.label = label;
  }
}

function parseEdgeLabel(
  rawLabel: string | undefined,
): { label?: string; annotations: EdgeAnnotations } {
  const annotations: EdgeAnnotations = {};

  if (!rawLabel) {
    return { label: undefined, annotations };
  }

  const trimmed = rawLabel.trim();

  // Check for exhaustion handler: "label:max"
  const exhaustionMatch = trimmed.match(/^(\w+):max$/);
  if (exhaustionMatch) {
    annotations.isExhaustionHandler = true;
    annotations.exhaustionLabel = exhaustionMatch[1];
    return { label: trimmed, annotations };
  }

  // Check for retry limit: "label max:N"
  const retryMatch = trimmed.match(/^(.+?)\s+max:(\d+)$/);
  if (retryMatch) {
    const label = retryMatch[1].trim();
    annotations.maxRetries = parseInt(retryMatch[2], 10);
    return { label, annotations };
  }

  return { label: trimmed, annotations };
}
