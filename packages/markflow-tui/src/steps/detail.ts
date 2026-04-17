// src/steps/detail.ts
//
// Pure projections from the engine slice into a `StepDetailModel` for the
// step detail pane (P6-T2). Exported formatters and pickers are also pure
// and composable.
//
// Authoritative references:
//   - docs/tui/features.md §3.4 + §3.9 + §5.10 + §6.2
//   - docs/tui/mockups.md §1 / §4 / §6 bottom panes
//   - docs/tui/plans/P6-T2.md §3
//
// PURITY NOTE: no ink/react/node:* imports. Only type-only imports from
// `markflow` + sibling pure modules. Theme glyph constants are permitted.

import type {
  EngineEvent,
  RunInfo,
  StepResult,
  StepType,
  Token,
} from "markflow";
import { UNICODE_GLYPHS } from "../theme/glyphs.js";
import type { GlyphKey } from "../theme/glyphs.js";
import type { ColorRole } from "../theme/tokens.js";
import type { StepsSnapshot } from "./types.js";
import type {
  LastLogLine,
  StderrTailLine,
  StepDetailAggregateData,
  StepDetailField,
  StepDetailModel,
  StepDetailSelection,
  StepDetailTokenData,
} from "./detail-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EM_DASH = "\u2014";
const ARROW = `  ${UNICODE_GLYPHS.arrow}  `;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a `StepDetailModel` for the currently-selected step table row.
 *
 * - `snapshot` is the permissive projection built from the ring buffer.
 * - `info` is the most-recent `RunInfo` — acts as a fallback for completed
 *   step types when the token map is sparse.
 * - `events` is the 500-event ring from `activeRun.events`.
 * - `selection.rowId` can be either `token.id` or `"batch:<batchId>"`.
 */
export function selectStepDetail(
  snapshot: StepsSnapshot | null,
  info: RunInfo | null,
  events: readonly EngineEvent[],
  selection: StepDetailSelection | null,
  nowMs: number,
): StepDetailModel {
  if (selection == null) return { kind: "empty" };
  const rowId = selection.rowId;

  if (rowId.startsWith("batch:")) {
    const batchId = rowId.slice("batch:".length);
    if (!snapshot) return { kind: "not-found", rowId };
    const batch = snapshot.batches.get(batchId);
    if (!batch) return { kind: "not-found", rowId };
    return {
      kind: "aggregate",
      data: buildAggregateData(batchId, batch, snapshot),
    };
  }

  // Token row.
  const token = snapshot ? snapshot.tokens.get(rowId) : undefined;
  if (token) {
    return {
      kind: "token",
      data: buildTokenData(token, snapshot!, info, events, nowMs),
    };
  }
  return { kind: "not-found", rowId };
}

// ---------------------------------------------------------------------------
// Aggregate variant
// ---------------------------------------------------------------------------

function buildAggregateData(
  batchId: string,
  batch: { readonly nodeId: string; readonly expected: number; readonly completed: number; readonly succeeded: number; readonly failed: number; readonly done: boolean; readonly status?: "ok" | "error" },
  snapshot: StepsSnapshot,
): StepDetailAggregateData {
  const role: ColorRole = !batch.done
    ? "running"
    : batch.status === "error"
      ? "failed"
      : "complete";
  const glyphKey: GlyphKey = "batch";
  const headline = `batch [${batch.nodeId}] \u00b7 forEach \u00b7 ${batch.completed}/${batch.expected}`;

  // earliest started_at across member tokens
  let earliestIso: string | null = null;
  let earliestMs: number | null = null;
  for (const t of snapshot.tokens.values()) {
    if (t.batchId !== batchId) continue;
    if (!t.result) continue;
    const ms = Date.parse(t.result.started_at);
    if (!Number.isFinite(ms)) continue;
    if (earliestMs == null || ms < earliestMs) {
      earliestMs = ms;
      earliestIso = t.result.started_at;
    }
  }

  const fields: StepDetailField[] = [
    { key: "status", label: "status", value: batch.done ? (batch.status ?? "ok") : "running", layout: "pair" },
    { key: "items", label: "items", value: `${batch.completed} / ${batch.expected}`, layout: "pair" },
    { key: "succeeded", label: "succeeded", value: String(batch.succeeded), layout: "pair" },
    { key: "failed", label: "failed", value: String(batch.failed), layout: "pair" },
    { key: "earliest", label: "earliest", value: earliestIso ?? EM_DASH, layout: "full" },
  ];

  return {
    batchId,
    nodeId: batch.nodeId,
    headline,
    role,
    glyphKey,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Token variant
// ---------------------------------------------------------------------------

function buildTokenData(
  token: Token,
  snapshot: StepsSnapshot,
  info: RunInfo | null,
  events: readonly EngineEvent[],
  nowMs: number,
): StepDetailTokenData {
  const nodeId = token.nodeId;
  const result = token.result ?? findCompletedResult(info, nodeId);
  const stepType = inferStepType(token, info);
  const typeLabel = computeStepTypeLabel(stepType);
  const seq = lastEventSeqForNode(events, nodeId);
  const headline = seq != null
    ? `${nodeId} \u00b7 ${typeLabel} \u00b7 seq=${seq}`
    : `${nodeId} \u00b7 ${typeLabel}`;

  // Status role + glyph match the token's effective state.
  const isFailed =
    token.state === "complete" && (result?.edge ?? "").startsWith("fail");
  const role: ColorRole = isFailed
    ? "failed"
    : token.state === "complete"
      ? "complete"
      : token.state === "running"
        ? "running"
        : token.state === "waiting"
          ? "waiting"
          : token.state === "skipped"
            ? "skipped"
            : "pending";
  const glyphKey: GlyphKey = isFailed
    ? "fail"
    : token.state === "complete"
      ? "ok"
      : token.state === "running"
        ? "running"
        : token.state === "waiting"
          ? "waiting"
          : token.state === "skipped"
            ? "skipped"
            : "pending";

  // Fields
  const attemptLabel = computeAttemptLabel(
    snapshot.retryBudgets,
    nodeId,
    result?.edge,
  );
  const timeoutLabel = computeTimeoutLabel(events, nodeId, result);
  const exitLabel =
    result && result.exit_code != null ? String(result.exit_code) : EM_DASH;
  const startedLabel = formatStartedLabel(token, result, nowMs);
  const endedLabel =
    token.state === "complete" && result ? formatIsoTime(result.completed_at) : EM_DASH;
  const edgeLabel = formatEdgeLabel(events, nodeId, result, token.state);
  const localLabel = formatJsonOneLine(result?.local, 100);
  const globalLabel = EM_DASH; // engine snapshot.globalContext is not on StepsSnapshot
  const lastLog = pickLastLog(events, nodeId);
  const lastLogLabel = lastLog
    ? `seq=${lastLog.seq}  ${lastLog.stream}  ${lastLog.text}`
    : EM_DASH;

  const fields: StepDetailField[] = [
    { key: "type", label: "type", value: typeLabel, layout: "pair" },
    { key: "attempt", label: "attempt", value: attemptLabel, layout: "pair" },
    { key: "timeout", label: "timeout", value: timeoutLabel, layout: "pair" },
    { key: "exit", label: "exit", value: exitLabel, layout: "pair" },
    { key: "started", label: "started", value: startedLabel, layout: "pair" },
    { key: "ended", label: "ended", value: endedLabel, layout: "pair" },
    { key: "edge", label: "edge", value: edgeLabel, layout: "pair" },
    { key: "local", label: "local", value: localLabel, layout: "full" },
    { key: "global", label: "global", value: globalLabel, layout: "full" },
    { key: "last log", label: "last log", value: lastLogLabel, layout: "full" },
  ];

  // Status line (§6 parity: terminal-failed step)
  let statusLine: string | null = null;
  if (isFailed && result) {
    const budget = matchingBudget(snapshot.retryBudgets, nodeId);
    const attempts = budget ? `${budget.count + 1}/${budget.max + 1}` : "1/1";
    const exhausted = result.edge === "fail:max" ? " \u00b7 exhausted" : "";
    statusLine = `${UNICODE_GLYPHS.fail} failed (${attempts} attempts${exhausted})`;
  }

  // Stderr tail + note
  const stderrTail = pickStderrTail(events, nodeId, 3);
  const stderrTailNote =
    stderrTail.length > 0
      ? "(last 3 lines \u2014 `2` or Tab for full log)"
      : null;

  return {
    nodeId,
    tokenId: token.id,
    seq,
    headline,
    statusLine,
    role,
    glyphKey,
    fields,
    stderrTail,
    stderrTailNote,
  };
}

// ---------------------------------------------------------------------------
// Field helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function computeStepTypeLabel(
  type: StepType | undefined,
): string {
  switch (type) {
    case "script":
      return "script (bash)";
    case "agent":
      return "agent";
    case "approval":
      return "approval";
    default:
      return EM_DASH;
  }
}

export function computeAttemptLabel(
  retryBudgets: ReadonlyMap<string, { count: number; max: number }>,
  nodeId: string,
  edge: string | undefined,
): string {
  const budget = matchingBudget(retryBudgets, nodeId);
  if (!budget) return EM_DASH;
  const current = budget.count + 1;
  const total = budget.max + 1;
  const exhausted = edge === "fail:max" ? ` \u00b7 exhausted` : "";
  return `${current}/${total}${exhausted}`;
}

function matchingBudget(
  retryBudgets: ReadonlyMap<string, { count: number; max: number }>,
  nodeId: string,
): { count: number; max: number } | undefined {
  for (const [key, budget] of retryBudgets) {
    if (key.startsWith(`${nodeId}:`)) return budget;
  }
  return undefined;
}

export function computeTimeoutLabel(
  events: readonly EngineEvent[],
  nodeId: string,
  result: StepResult | undefined,
): string {
  // (a) An emitted step:timeout event for this node gives us its limit.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "step:timeout" && ev.nodeId === nodeId) {
      return formatMsAsDuration(ev.limitMs);
    }
  }
  // (b) Terminal step routed via "timeout" — we know a timeout fired but
  // not the limit. Best-effort: show em-dash (no hard data) rather than
  // fabricating one. Callers can still see `edge` value = "timeout".
  if (result?.edge === "timeout") return EM_DASH;
  return EM_DASH;
}

function formatMsAsDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return EM_DASH;
  const totalSeconds = Math.round(ms / 1000);
  // Mockups §4 + §6 express per-step timeouts in seconds (`90s`, `60s`).
  // Keep the `<N>s` form up to 3600 so plan fixtures render verbatim.
  if (totalSeconds < 3600) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function formatStartedLabel(
  token: Token,
  result: StepResult | undefined,
  nowMs: number,
): string {
  if (!result) return EM_DASH;
  const base = formatIsoTime(result.started_at);
  if (token.state === "running") {
    const ms = Date.parse(result.started_at);
    if (Number.isFinite(ms)) {
      const diff = Math.max(0, Math.floor((nowMs - ms) / 1000));
      return `${base} (${diff}s ago)`;
    }
  }
  return base;
}

function formatIsoTime(iso: string): string {
  if (!iso) return EM_DASH;
  // Extract HH:MM:SS from an ISO-8601 timestamp.
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? m[1]! : iso;
}

function formatEdgeLabel(
  events: readonly EngineEvent[],
  nodeId: string,
  result: StepResult | undefined,
  state: Token["state"],
): string {
  if (state !== "complete" || !result) return EM_DASH;
  const edge = result.edge ?? "";
  if (!edge) return EM_DASH;
  const target = pickRouteTarget(events, nodeId, edge);
  if (target) return `${edge}${ARROW}${target}`;
  return edge;
}

// ---------------------------------------------------------------------------
// Log pickers
// ---------------------------------------------------------------------------

export function pickLastLog(
  events: readonly EngineEvent[],
  nodeId: string,
): LastLogLine | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type !== "step:output") continue;
    if (ev.nodeId !== nodeId) continue;
    const lines = ev.chunk.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    return {
      seq: ev.seq,
      stream: ev.stream,
      text: lines[lines.length - 1]!,
    };
  }
  return null;
}

export function pickStderrTail(
  events: readonly EngineEvent[],
  nodeId: string,
  max: number,
): ReadonlyArray<StderrTailLine> {
  if (max <= 0) return [];
  // Walk in reverse collecting lines; we push most-recent first then reverse.
  const collectedReversed: StderrTailLine[] = [];
  for (let i = events.length - 1; i >= 0 && collectedReversed.length < max; i--) {
    const ev = events[i]!;
    if (ev.type !== "step:output") continue;
    if (ev.stream !== "stderr") continue;
    if (ev.nodeId !== nodeId) continue;
    const lines = ev.chunk.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    // Walk lines inside this chunk newest-to-oldest.
    for (let j = lines.length - 1; j >= 0 && collectedReversed.length < max; j--) {
      collectedReversed.push({ seq: ev.seq, text: lines[j]! });
    }
  }
  return collectedReversed.reverse();
}

export function pickRouteTarget(
  events: readonly EngineEvent[],
  nodeId: string,
  edge: string,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type !== "route") continue;
    if (ev.from !== nodeId) continue;
    if ((ev.edge ?? "") !== edge) continue;
    return ev.to;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON one-line formatter (keeps the detail pane single-row per field)
// ---------------------------------------------------------------------------

/**
 * Format `value` as a single-line pseudo-JSON string. Truncates at the key
 * boundary (drops trailing keys) when the result would exceed `budget`.
 * See docs/tui/plans/P6-T2.md §3.7.
 */
export function formatJsonOneLine(
  value: unknown,
  budget: number,
): string {
  if (value === null || value === undefined) return EM_DASH;
  if (typeof value !== "object") return formatScalar(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatScalar(v));
    const full = `[${parts.join(", ")}]`;
    return truncateToBudget(full, budget);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const rendered: string[] = [];
  for (const [k, v] of entries) {
    rendered.push(`${k}: ${formatScalar(v)}`);
  }
  // Try full first; if over budget, drop trailing entries replacing with "…".
  let full = `{ ${rendered.join(", ")} }`;
  if (full.length <= budget) return full;
  // Progressive trim.
  for (let keep = rendered.length - 1; keep >= 1; keep--) {
    const truncated = `{ ${rendered.slice(0, keep).join(", ")}, \u2026 }`;
    if (truncated.length <= budget) return truncated;
  }
  // Even a single key overflows — truncate its value portion.
  return truncateToBudget(full, budget);
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return EM_DASH;
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(formatScalar).join(", ")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{ ${entries.map(([k, vv]) => `${k}: ${formatScalar(vv)}`).join(", ")} }`;
  }
  return String(v);
}

function truncateToBudget(s: string, budget: number): string {
  if (budget <= 1) return "\u2026";
  if (s.length <= budget) return s;
  return s.slice(0, Math.max(1, budget - 1)) + "\u2026";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferStepType(token: Token, info: RunInfo | null): StepType | undefined {
  if (token.result?.type) return token.result.type;
  // Fall back to a completed result for the same node.
  const completed = findCompletedResult(info, token.nodeId);
  return completed?.type;
}

function findCompletedResult(
  info: RunInfo | null,
  nodeId: string,
): StepResult | undefined {
  if (!info) return undefined;
  for (let i = info.steps.length - 1; i >= 0; i--) {
    const s = info.steps[i]!;
    if (s.node === nodeId) return s;
  }
  return undefined;
}

function lastEventSeqForNode(
  events: readonly EngineEvent[],
  nodeId: string,
): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "step:start" && ev.nodeId === nodeId) return ev.seq;
    if (ev.type === "step:complete" && ev.nodeId === nodeId) return ev.seq;
    if (ev.type === "step:output" && ev.nodeId === nodeId) return ev.seq;
  }
  return null;
}
