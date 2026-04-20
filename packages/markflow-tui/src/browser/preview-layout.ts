// src/browser/preview-layout.ts
//
// Pure formatters for the workflow preview pane. Each function takes plain
// data (engine types + primitives) and returns strings / tuples. No React,
// no Ink, no node:*, no fs. Enforced by `test/state/purity.test.ts`.
//
// Authoritative references:
//   - docs/tui/features.md §3.1
//   - docs/tui/mockups.md §2
//   - docs/tui/plans/P4-T2.md §2.2

import type {
  FlowEdge,
  FlowNode,
  InputDeclaration,
  ValidationDiagnostic,
  WorkflowDefinition,
} from "markflow-cli";
import type { ResolvedEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FLOW_BODY_LINES = 6;

// ---------------------------------------------------------------------------
// formatEntryId
// ---------------------------------------------------------------------------

/**
 * Returns `entry.source` verbatim. The registry does not carry a stable id
 * of its own (addEntry dedupes by source), so we use source as the
 * SELECT_WORKFLOW dispatch key.
 */
export function formatEntryId(entry: { readonly source: string }): string {
  return entry.source;
}

// ---------------------------------------------------------------------------
// formatDurationShort — ms -> "45s" | "2h" | "3d"
// ---------------------------------------------------------------------------

/**
 * Short-form duration. Used by `formatStatusFlag` to render last-run age.
 *
 *   <60s            → "Ns"
 *   <60min          → "Nm"
 *   <24h            → "Nh"
 *   otherwise       → "Nd"
 */
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// formatInputsSummary
// ---------------------------------------------------------------------------

/**
 * Returns the "## Inputs" block lines. Leading "## Inputs" header is
 * returned as line[0]; body is indented two spaces. Empty array when the
 * workflow declares no inputs.
 */
export function formatInputsSummary(
  inputs: ReadonlyArray<InputDeclaration>,
): ReadonlyArray<string> {
  if (inputs.length === 0) return [];
  const nameCol = Math.max(...inputs.map((i) => i.name.length));
  const kindCol = Math.max(
    ...inputs.map((i) =>
      i.required ? "required".length : `default:${i.default ?? ""}`.length,
    ),
  );
  const out: string[] = ["## Inputs"];
  for (const i of inputs) {
    const name = i.name.padEnd(nameCol);
    const kind = i.required ? "required" : `default:${i.default ?? ""}`;
    const kindPadded = kind.padEnd(kindCol);
    const desc = i.description ? `  ${i.description}` : "";
    out.push(`  ${name}  ${kindPadded}${desc}`.trimEnd());
  }
  return out;
}

// ---------------------------------------------------------------------------
// formatFlowSummary
// ---------------------------------------------------------------------------

interface WalkState {
  readonly lines: string[];
  readonly visited: Set<string>;
  /** Edges actually rendered as a chain segment or continuation line. */
  edgesRendered: number;
}

/**
 * Returns the "## Flow" block as lines. Walks the graph from start nodes
 * (or nodes with no incoming edges) along the first outgoing "success"
 * edge, emitting `a → b → c` style chains. Branches (forEach / extra
 * outgoing edges) render as indented continuation lines with `└─▶`.
 *
 * Caps at 6 body lines; overflow collapses to "  … (N more edges)".
 * Never recurses past a visited node — cycles are safe.
 */
export function formatFlowSummary(
  workflow: WorkflowDefinition,
): ReadonlyArray<string> {
  const { graph } = workflow;
  if (graph.edges.length === 0 && graph.nodes.size === 0) return [];
  const starts = findStartNodes(workflow);
  if (starts.length === 0) return [];

  const state: WalkState = {
    lines: [],
    visited: new Set(),
    edgesRendered: 0,
  };
  const totalEdges = graph.edges.length;

  for (const start of starts) {
    if (state.lines.length >= MAX_FLOW_BODY_LINES) break;
    walkChain(start.id, workflow, state);
  }

  // If we truncated to the cap, the chain lines count edges implicitly. We
  // count chain-segment edges here by counting " → " occurrences. Branch
  // lines each represent exactly one edge (they contain "└─▶").
  let visibleEdges = 0;
  const body = state.lines.slice(0, MAX_FLOW_BODY_LINES);
  for (const line of body) {
    if (line.includes("└─▶")) {
      visibleEdges += 1;
    } else {
      visibleEdges += (line.match(/ → /g) ?? []).length;
    }
  }

  if (visibleEdges < totalEdges) {
    const remaining = totalEdges - visibleEdges;
    body.push(`  … (${remaining} more edge${remaining === 1 ? "" : "s"})`);
  }
  // Avoid unused lint warning on edgesRendered if nothing else uses it.
  void state.edgesRendered;

  return ["## Flow", ...body];
}

function findStartNodes(workflow: WorkflowDefinition): ReadonlyArray<FlowNode> {
  const explicit: FlowNode[] = [];
  for (const node of workflow.graph.nodes.values()) {
    if (node.isStart === true) explicit.push(node);
  }
  if (explicit.length > 0) return explicit;
  // Fallback: nodes with no incoming edges.
  const hasIncoming = new Set<string>();
  for (const edge of workflow.graph.edges) {
    hasIncoming.add(edge.to);
  }
  const out: FlowNode[] = [];
  for (const node of workflow.graph.nodes.values()) {
    if (!hasIncoming.has(node.id)) out.push(node);
  }
  return out;
}

function nodeDisplay(id: string, workflow: WorkflowDefinition): string {
  const step = workflow.steps.get(id);
  if (step?.type === "approval") return `${id}(approval)`;
  return id;
}

function walkChain(
  startId: string,
  workflow: WorkflowDefinition,
  state: WalkState,
): void {
  if (state.lines.length >= MAX_FLOW_BODY_LINES) return;

  const chain: string[] = [];
  const extraEdges: FlowEdge[] = [];
  let current: string | null = startId;

  while (current !== null) {
    if (state.visited.has(current)) {
      chain.push("(cycle)");
      break;
    }
    state.visited.add(current);
    chain.push(nodeDisplay(current, workflow));

    const outgoing = workflow.graph.edges.filter((e) => e.from === current);
    if (outgoing.length === 0) break;

    // Prefer a non-forEach "normal" (unlabeled / success) edge as the primary
    // chain continuation. forEach/fail/labelled edges are rendered as
    // continuation lines regardless of whether they are the only outgoing
    // edge — they're semantically "sidecar" routes, not the main flow.
    const primaryIdx = outgoing.findIndex(
      (e) =>
        e.annotations.forEach === undefined &&
        e.label !== "fail" &&
        !e.annotations.isExhaustionHandler,
    );

    if (primaryIdx < 0) {
      // Every outgoing edge is a sidecar — emit them all as branches and
      // terminate the chain here.
      for (const e of outgoing) {
        extraEdges.push(e);
        state.edgesRendered += 1;
      }
      break;
    }

    const primary: FlowEdge = outgoing[primaryIdx]!;
    state.edgesRendered += 1;
    for (let i = 0; i < outgoing.length; i++) {
      if (i === primaryIdx) continue;
      extraEdges.push(outgoing[i]!);
      state.edgesRendered += 1;
    }
    current = primary.to;
  }

  state.lines.push(`  ${chain.join(" → ")}`);

  for (const e of extraEdges) {
    if (state.lines.length >= MAX_FLOW_BODY_LINES) return;
    const target = nodeDisplay(e.to, workflow);
    if (e.annotations.forEach) {
      state.lines.push(
        `     └─▶ forEach ${e.annotations.forEach.key}: ${target}`,
      );
    } else if (e.label === "fail") {
      state.lines.push(`     └─▶ fail: ${target}`);
    } else if (e.label) {
      state.lines.push(`     └─▶ ${e.label}: ${target}`);
    } else {
      state.lines.push(`     └─▶ ${target}`);
    }
  }
}

// ---------------------------------------------------------------------------
// formatDiagnostics
// ---------------------------------------------------------------------------

/**
 * One-line-per-diagnostic formatter with severity glyph. Errors first,
 * then warnings; within each bucket preserves input order.
 */
export function formatDiagnostics(
  diagnostics: ReadonlyArray<ValidationDiagnostic>,
  glyphs: { readonly error: string; readonly warning: string },
): ReadonlyArray<string> {
  if (diagnostics.length === 0) return [];
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.severity === "error") errors.push(d);
    else warnings.push(d);
  }
  const out: string[] = [];
  for (const d of [...errors, ...warnings]) {
    const glyph = d.severity === "error" ? glyphs.error : glyphs.warning;
    const code = d.code ?? "(no code)";
    const nodeHint = d.nodeId ? `${d.nodeId}: ` : "";
    out.push(`${glyph} ${code}  ${nodeHint}${d.message}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// countSteps / formatStepCountLine
// ---------------------------------------------------------------------------

export interface StepCounts {
  readonly steps: number;
  readonly approvals: number;
  readonly forEach: number;
}

export function countSteps(workflow: WorkflowDefinition): StepCounts {
  let approvals = 0;
  for (const step of workflow.steps.values()) {
    if (step.type === "approval") approvals += 1;
  }
  let forEach = 0;
  for (const edge of workflow.graph.edges) {
    if (edge.annotations.forEach !== undefined) forEach += 1;
  }
  return { steps: workflow.steps.size, approvals, forEach };
}

function pluralise(n: number, singular: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${singular}s`;
}

export function formatStepCountLine(counts: StepCounts): string {
  const parts: string[] = [pluralise(counts.steps, "step")];
  if (counts.approvals > 0) parts.push(pluralise(counts.approvals, "approval"));
  if (counts.forEach > 0) parts.push(`${counts.forEach} forEach`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// formatSourceBadge
// ---------------------------------------------------------------------------

export function formatSourceBadge(resolved: ResolvedEntry): string {
  return resolved.sourceKind === "workspace" ? "[workspace]" : "[file]";
}

// ---------------------------------------------------------------------------
// formatStatusFlag
// ---------------------------------------------------------------------------

export interface StatusFlag {
  readonly text: string;
  readonly tone: "good" | "bad" | "neutral";
}

/**
 * Returns the small flag displayed in the trailing column of each list row.
 * See `docs/tui/plans/P4-T2.md §2.2` for the truth table.
 */
export function formatStatusFlag(
  resolved: ResolvedEntry,
  now?: number,
): StatusFlag {
  if (resolved.status === "missing") {
    return { text: "✗ 404", tone: "bad" };
  }
  if (resolved.status === "parse-error") {
    return { text: "✗ parse", tone: "bad" };
  }
  if (resolved.status === "pending") {
    return { text: "…", tone: "neutral" };
  }
  // status === "valid"
  const lastRun = resolved.lastRun;
  if (!lastRun) return { text: "— never", tone: "neutral" };
  const endedAt = lastRun.endedAt ? Date.parse(lastRun.endedAt) : null;
  const age =
    endedAt !== null && Number.isFinite(endedAt) && now !== undefined
      ? Math.max(0, now - endedAt)
      : 0;
  const ageText = endedAt !== null ? formatDurationShort(age) : "live";
  if (lastRun.status === "complete") {
    return { text: `✓ ${ageText}`, tone: "good" };
  }
  if (lastRun.status === "error") {
    return { text: `✗ ${ageText}`, tone: "bad" };
  }
  // running / suspended
  return { text: `· ${ageText}`, tone: "neutral" };
}
