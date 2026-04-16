import type { FlowGraph, FlowEdge, StepResult, MarkflowConfig } from "./types.js";
import { getOutgoingEdges } from "./graph.js";
import { ExecutionError } from "./errors.js";

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
  /** Set when the matched edge has a retry budget; includes count and max. */
  retryIncrement?: { label: string; count: number; max: number };
}

const SUCCESS_LABELS = ["next", "pass", "ok", "success", "done"];
const FAILURE_LABELS = ["fail", "error", "retry"];

function inGroup(label: string | undefined, group: string[]): boolean {
  return typeof label === "string" && group.includes(label);
}

/**
 * Effective retry budget for an edge: explicit `max:N` wins; otherwise
 * `config.maxRetriesDefault` applies only when the edge has a failure-group
 * label AND a corresponding `:max` exhaustion handler exists. Without a
 * handler the default is ignored — silently enabling retries on a flow that
 * has no exhaustion branch would just turn into an ExecutionError at budget
 * time.
 */
export function effectiveMaxRetries(
  edge: FlowEdge,
  graph: FlowGraph,
  nodeId: string,
  config: MarkflowConfig,
): number | undefined {
  if (edge.annotations.maxRetries !== undefined) return edge.annotations.maxRetries;
  if (config.maxRetriesDefault === undefined) return undefined;
  if (!edge.label || !FAILURE_LABELS.includes(edge.label)) return undefined;
  const hasHandler = getOutgoingEdges(graph, nodeId).some(
    (e) =>
      e.annotations.isExhaustionHandler &&
      e.annotations.exhaustionLabel === edge.label,
  );
  return hasHandler ? config.maxRetriesDefault : undefined;
}

/**
 * Resolve which edge(s) to follow after a node completes.
 */
export function resolveRoute(
  graph: FlowGraph,
  nodeId: string,
  result: StepResult,
  retryState: RetryState,
  config: MarkflowConfig,
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
    // 1. Exact label match
    const edgeLabel = result.edge;
    matchedEdge = normalEdges.find((e) => e.label === edgeLabel);

    // 2. Synonym group match — `next`/`pass`/`ok`/`success`/`done` are
    //    treated as interchangeable success signals; `fail`/`error`/`retry`
    //    as interchangeable failure signals. Lets silent exit-0 steps
    //    (default edge "next") route to an existing `pass` branch, and
    //    keeps pre-existing `pass`/`done` flows working unchanged.
    if (!matchedEdge) {
      if (inGroup(edgeLabel, SUCCESS_LABELS)) {
        matchedEdge = normalEdges.find((e) => inGroup(e.label, SUCCESS_LABELS));
      } else if (inGroup(edgeLabel, FAILURE_LABELS)) {
        matchedEdge = normalEdges.find((e) => inGroup(e.label, FAILURE_LABELS));
      }
    }

    // 3. Unlabelled edge as catch-all
    if (!matchedEdge && unlabelled.length > 0) {
      matchedEdge = unlabelled[0];
    }
  }

  if (!matchedEdge) {
    throw new ExecutionError(
      `Routing error: no matching edge from "${nodeId}" for result edge "${result.edge}"`,
    );
  }

  // Check retry budget. `resolveRoute` is a pure decision function — it
  // peeks at the counter but does *not* mutate it. The caller applies the
  // bump via `incrementRetry` inside write-ahead event emission so that
  // replay can reconstruct the same counter from the event log.
  let retryIncrement: RouteDecision["retryIncrement"];
  const max = effectiveMaxRetries(matchedEdge, graph, nodeId, config);
  if (max !== undefined && matchedEdge.label) {
    const count = peekRetry(retryState, nodeId, matchedEdge.label) + 1;
    retryIncrement = { label: matchedEdge.label, count, max };

    if (count > max) {
      // Budget exhausted — look for :max handler
      const handler = exhaustionEdges.find(
        (e) => e.annotations.exhaustionLabel === matchedEdge!.label,
      );
      if (!handler) {
        throw new ExecutionError(
          `Retry budget exhausted for "${matchedEdge.label}" from "${nodeId}" but no :max handler found`,
        );
      }
      return {
        targets: [{ nodeId: handler.to, edge: handler }],
        exhausted: true,
        retryIncrement,
      };
    }
  }

  return {
    targets: [{ nodeId: matchedEdge.to, edge: matchedEdge }],
    exhausted: false,
    retryIncrement,
  };
}

function peekRetry(state: RetryState, nodeId: string, label: string): number {
  return state.counters.get(nodeId)?.get(label) ?? 0;
}

export function incrementRetry(
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
