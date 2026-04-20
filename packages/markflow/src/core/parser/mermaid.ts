import { parseFlowchart } from "mermaid-ast";
import type { FlowGraph, FlowNode, FlowEdge, EdgeAnnotations } from "../types.js";
import { ParseError } from "../errors.js";

export function parseMermaidFlowchart(source: string): FlowGraph {
  const cleaned = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("%%"))
    .join("\n");

  let ast;
  try {
    ast = parseFlowchart(cleaned);
  } catch (err) {
    throw new ParseError(
      `Invalid mermaid flowchart: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const nodes = new Map<string, FlowNode>();
  for (const [id, node] of ast.nodes) {
    nodes.set(id, {
      id,
      label: node.text?.text,
      shape: node.shape,
      ...(node.shape === "stadium" ? { isStart: true } : {}),
    });
  }

  const edges: FlowEdge[] = ast.links.map((link) => {
    const stroke = (link as { stroke?: string }).stroke ?? "normal";
    const { label, annotations } = parseEdgeLabel(link.text?.text);
    return {
      from: link.source,
      to: link.target,
      label,
      stroke: stroke as FlowEdge["stroke"],
      annotations,
    };
  });

  return { nodes, edges };
}

function parseEdgeLabel(
  rawLabel: string | undefined,
): { label?: string; annotations: EdgeAnnotations } {
  const annotations: EdgeAnnotations = {};

  if (!rawLabel) {
    return { label: undefined, annotations };
  }

  const trimmed = rawLabel.trim();

  const forEachMatch = trimmed.match(/^each:\s*(\w+)$/);
  if (forEachMatch) {
    annotations.forEach = { key: forEachMatch[1] };
    return { label: trimmed, annotations };
  }

  const exhaustionMatch = trimmed.match(/^(\w+):max$/);
  if (exhaustionMatch) {
    annotations.isExhaustionHandler = true;
    annotations.exhaustionLabel = exhaustionMatch[1];
    return { label: trimmed, annotations };
  }

  const retryMatch = trimmed.match(/^(.+?)\s+max:(\d+)$/);
  if (retryMatch) {
    const label = retryMatch[1].trim();
    annotations.maxRetries = parseInt(retryMatch[2], 10);
    return { label, annotations };
  }

  return { label: trimmed, annotations };
}
