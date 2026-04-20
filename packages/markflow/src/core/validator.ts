import type {
  WorkflowDefinition,
  ValidationDiagnostic,
  FlowEdge,
} from "./types.js";
import {
  getStartNodes,
  getOutgoingEdges,
  getForEachScope,
  findForEachSource,
} from "./graph.js";

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

  // 8. Approval-step rules: options must correspond to outgoing edge labels.
  for (const step of steps.values()) {
    if (step.type !== "approval") continue;
    const cfg = step.approvalConfig;
    if (!cfg) {
      diagnostics.push({
        severity: "error",
        message: `Approval step "${step.id}" is missing its approvalConfig`,
        nodeId: step.id,
        line: step.line,
        source,
      });
      continue;
    }
    if (!graph.nodes.has(step.id)) {
      // Step not in graph — skip edge checks (will already diagnose via rule 2)
      continue;
    }
    const outgoing = getOutgoingEdges(graph, step.id);
    const edgeLabels = new Set(
      outgoing
        .filter((e) => !e.annotations.isExhaustionHandler && e.label)
        .map((e) => e.label!),
    );
    for (const opt of cfg.options) {
      if (!edgeLabels.has(opt)) {
        diagnostics.push({
          severity: "error",
          message: `Approval step "${step.id}" option "${opt}" has no matching outgoing edge labelled "${opt}"`,
          nodeId: step.id,
          line: step.line,
          source,
          suggestion: `Add an edge \`${step.id} -->|${opt}| <target>\` or remove the option.`,
        });
      }
    }
    const optionSet = new Set(cfg.options);
    for (const label of edgeLabels) {
      if (!optionSet.has(label)) {
        diagnostics.push({
          severity: "error",
          message: `Approval step "${step.id}" has outgoing edge "${label}" but no matching entry in \`options\``,
          nodeId: step.id,
          line: step.line,
          source,
          suggestion: `Add "${label}" to the options list, or drop the edge.`,
        });
      }
    }
  }

  // 10. forEach structural rules
  const forEachSources = new Set<string>();
  for (const nodeId of graph.nodes.keys()) {
    const outgoing = getOutgoingEdges(graph, nodeId);
    const hasThickEach = outgoing.some(
      (e) => e.stroke === "thick" && e.annotations.forEach,
    );
    if (hasThickEach) forEachSources.add(nodeId);
  }

  // 10a. FOREACH_LABEL_MISSING_KEY — thick `each:` edge with no / empty key
  for (const edge of graph.edges) {
    if (edge.stroke !== "thick") continue;
    if (edge.annotations.forEach) continue;
    // Label present, starts with `each:`, but didn't parse — missing/empty key.
    if (edge.label && /^each:/i.test(edge.label.trim())) {
      diagnostics.push({
        severity: "error",
        code: "FOREACH_LABEL_MISSING_KEY",
        message: `Thick edge from "${edge.from}" has an \`each:\` label with no key (got "${edge.label}")`,
        nodeId: edge.from,
        source,
        suggestion: "Use `==>|each: KEY|` where KEY is the LOCAL array name.",
      });
    }
  }

  // 10b. FOREACH_NO_COLLECTOR — thick chain terminates without a normal fan-in
  for (const sourceNodeId of forEachSources) {
    const scope = getForEachScope(graph, sourceNodeId);
    if (!scope) {
      diagnostics.push({
        severity: "error",
        code: "FOREACH_NO_COLLECTOR",
        message: `forEach chain from "${sourceNodeId}" does not terminate at a collector (first normal edge)`,
        nodeId: sourceNodeId,
        source,
        suggestion:
          "End the `==>` chain with a normal edge `-->` to a collector node.",
      });
    }
  }

  // 10c. FOREACH_ORPHAN_THICK — thick edge whose source is neither a forEach
  //      source nor inside an existing forEach body chain.
  for (const edge of graph.edges) {
    if (edge.stroke !== "thick") continue;
    if (edge.annotations.forEach) continue; // labelled `each:` — already checked
    if (forEachSources.has(edge.from)) continue; // legit chain start
    const parentScope = findForEachSource(graph, edge.from);
    if (!parentScope) {
      diagnostics.push({
        severity: "error",
        code: "FOREACH_ORPHAN_THICK",
        message: `Thick edge from "${edge.from}" is not part of any forEach chain`,
        nodeId: edge.from,
        source,
        suggestion:
          "Use a normal `-->` edge, or make this node part of a chain started by `==>|each: KEY|`.",
      });
    }
  }

  // 10d. FOREACH_NESTED — a body node of one forEach has its own `each:` edge
  for (const sourceNodeId of forEachSources) {
    const parentScope = findForEachSource(graph, sourceNodeId);
    if (parentScope) {
      diagnostics.push({
        severity: "error",
        code: "FOREACH_NESTED",
        message: `forEach source "${sourceNodeId}" is nested inside another forEach (body of "${parentScope.sourceNodeId}") — unsupported in v1`,
        nodeId: sourceNodeId,
        source,
        suggestion:
          "Flatten the workflow so only one forEach is active at a time, or split into sequential runs.",
      });
    }
  }

  // 10e. FOREACH_INVALID_CONCURRENCY — maxConcurrency must be a non-negative integer
  for (const sourceNodeId of forEachSources) {
    const step = def.steps.get(sourceNodeId);
    const mc = step?.stepConfig?.foreach?.maxConcurrency;
    if (mc !== undefined && (!Number.isInteger(mc) || mc < 0)) {
      diagnostics.push({
        severity: "error",
        code: "FOREACH_INVALID_CONCURRENCY",
        message: `forEach maxConcurrency on "${sourceNodeId}" must be a non-negative integer (got ${mc})`,
        nodeId: sourceNodeId,
        source,
      });
    }
  }

  // 9. Duplicate input names
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
