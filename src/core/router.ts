import type { FlowGraph, FlowEdge, StepResult, MarkflowConfig } from "./types.js";
import { getOutgoingEdges } from "./graph.js";

export interface RetryState {
  /** nodeId → edgeLabel → count */
  counters: Map<string, Map<string, number>>;
}

export function createRetryState(): RetryState {
  return { counters: new Map() };
}

export interface RouteDecision {
  targets: Array<{ nodeId: string; edge: FlowEdge }>;
  exhausted: boolean;
}

const SUCCESS_LABELS = ["pass", "ok", "success", "done"];
const FAILURE_LABELS = ["fail", "error", "retry"];

/**
 * Resolve which edge(s) to follow after a node completes.
 */
export function resolveRoute(
  graph: FlowGraph,
  nodeId: string,
  result: StepResult,
  retryState: RetryState,
  _config: MarkflowConfig,
): RouteDecision {
  const outgoing = getOutgoingEdges(graph, nodeId);

  if (outgoing.length === 0) {
    // Terminal node — no routing needed
    return { targets: [], exhausted: false };
  }

  // Filter out exhaustion handler edges for initial matching
  const normalEdges = outgoing.filter(
    (e) => !e.annotations.isExhaustionHandler,
  );
  const exhaustionEdges = outgoing.filter(
    (e) => e.annotations.isExhaustionHandler,
  );

  // Check for fan-out first: all unlabelled edges to different targets
  const unlabelled = normalEdges.filter((e) => !e.label);
  if (unlabelled.length > 1) {
    const uniqueTargets = [...new Set(unlabelled.map((e) => e.to))];
    if (uniqueTargets.length > 1) {
      return {
        targets: unlabelled.map((e) => ({ nodeId: e.to, edge: e })),
        exhausted: false,
      };
    }
  }

  let matchedEdge: FlowEdge | undefined;

  if (normalEdges.length === 1 && exhaustionEdges.length === 0) {
    // Single outgoing edge — follow it regardless of label
    matchedEdge = normalEdges[0];
  } else {
    // Multiple outgoing edges — match by result edge label
    const edgeLabel = result.edge;
    matchedEdge = normalEdges.find((e) => e.label === edgeLabel);

    // If no match and step is a script, try exit code mapping
    if (!matchedEdge && result.type === "script" && result.exit_code !== null) {
      if (result.exit_code === 0) {
        matchedEdge = normalEdges.find(
          (e) => e.label && SUCCESS_LABELS.includes(e.label),
        );
      } else {
        matchedEdge = normalEdges.find(
          (e) => e.label && FAILURE_LABELS.includes(e.label),
        );
      }
    }

    // Last resort: if there's exactly one unlabelled edge, use it
    if (!matchedEdge) {
      if (unlabelled.length === 1) {
        matchedEdge = unlabelled[0];
      }
    }
  }

  if (!matchedEdge) {
    throw new Error(
      `Routing error: no matching edge from "${nodeId}" for result edge "${result.edge}"`,
    );
  }

  // Check retry budget
  if (matchedEdge.annotations.maxRetries !== undefined && matchedEdge.label) {
    const count = incrementRetry(retryState, nodeId, matchedEdge.label);
    const max = matchedEdge.annotations.maxRetries;

    if (count > max) {
      // Budget exhausted — look for :max handler
      const handler = exhaustionEdges.find(
        (e) => e.annotations.exhaustionLabel === matchedEdge!.label,
      );
      if (!handler) {
        throw new Error(
          `Retry budget exhausted for "${matchedEdge.label}" from "${nodeId}" but no :max handler found`,
        );
      }
      return {
        targets: [{ nodeId: handler.to, edge: handler }],
        exhausted: true,
      };
    }
  }

  return {
    targets: [{ nodeId: matchedEdge.to, edge: matchedEdge }],
    exhausted: false,
  };
}

function incrementRetry(
  state: RetryState,
  nodeId: string,
  label: string,
): number {
  if (!state.counters.has(nodeId)) {
    state.counters.set(nodeId, new Map());
  }
  const nodeCounters = state.counters.get(nodeId)!;
  const current = (nodeCounters.get(label) ?? 0) + 1;
  nodeCounters.set(label, current);
  return current;
}
