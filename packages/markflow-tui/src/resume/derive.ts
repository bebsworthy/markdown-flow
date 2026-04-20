// src/resume/derive.ts
//
// Pure projections for the resume wizard.
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type {
  EngineEvent,
  RunInfo,
  Token,
  WorkflowDefinition,
} from "markflow-cli";
import type { InputRow, RerunNode, ResumableRun } from "./types.js";

/**
 * Snapshot summary for the wizard header. Returns `null` if the run is not
 * resumable (status not in {"error","suspended"}). Pure; deterministic.
 */
export function deriveResumableRun(
  info: RunInfo,
  events: readonly EngineEvent[],
): ResumableRun | null {
  if (info.status !== "error" && info.status !== "suspended") return null;
  let lastSeq = 0;
  let lastLabel: string = info.status;
  for (const ev of events) {
    if (typeof ev.seq === "number" && ev.seq > lastSeq) lastSeq = ev.seq;
  }
  // Prefer the most recent terminal / failure-site event.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.type === "retry:exhausted") {
      lastLabel = `retry:exhausted at ${e.nodeId}`;
      break;
    }
    if (e.type === "workflow:error") {
      lastLabel = `workflow:error: ${e.error}`;
      break;
    }
    if (e.type === "step:waiting") {
      lastLabel = `step:waiting at ${e.nodeId}`;
      break;
    }
    if (e.type === "step:complete" && e.result && e.result.exit_code !== 0) {
      lastLabel = `step:complete(exit ${e.result.exit_code ?? "?"}) at ${e.nodeId}`;
      break;
    }
  }
  return {
    runId: info.id,
    workflowName: info.workflowName,
    status: info.status,
    startedAt: info.startedAt,
    lastSeq,
    lastEventLabel: lastLabel,
  };
}

/**
 * Build the rerun-node list. `tokens` is optional — when omitted, tokens are
 * reconstructed from `events`. When provided, trusted as source of truth.
 *
 * Order: failing → waiting → complete → skipped. Preselection: the single
 * failing token, if any; else the oldest waiting token; else none.
 */
export function deriveRerunNodes(
  info: RunInfo,
  events: readonly EngineEvent[],
  tokens?: ReadonlyMap<string, Token>,
): readonly RerunNode[] {
  const resolved = tokens ?? reconstructTokens(events);
  // Track failing + waiting tokenIds for preselection.
  const failingTokenIds = new Set<string>();
  const waitingTokenIds = new Set<string>();
  const failureOrder: string[] = []; // tokenIds in order of failure occurrence
  const lastTransitionSeq = new Map<string, number>();

  for (const e of events) {
    if (e.type === "step:complete") {
      lastTransitionSeq.set(e.tokenId, e.seq);
      if (e.result && e.result.exit_code !== null && e.result.exit_code !== 0) {
        if (!failingTokenIds.has(e.tokenId)) failureOrder.push(e.tokenId);
        failingTokenIds.add(e.tokenId);
      } else {
        failingTokenIds.delete(e.tokenId);
      }
    } else if (e.type === "step:waiting") {
      lastTransitionSeq.set(e.tokenId, e.seq);
      waitingTokenIds.add(e.tokenId);
    } else if (e.type === "approval:decided") {
      waitingTokenIds.delete(e.tokenId);
    } else if (e.type === "step:start" || e.type === "token:state" || e.type === "step:retry") {
      const tid = "tokenId" in e ? (e as { tokenId?: string }).tokenId : undefined;
      if (tid) lastTransitionSeq.set(tid, e.seq);
    }
  }

  const rows: RerunNode[] = [];
  for (const [tokenId, tok] of resolved) {
    // Translate engine TokenState → our narrower set.
    const state: RerunNode["state"] =
      tok.state === "running" || tok.state === "pending"
        ? "waiting"
        : tok.state === "complete"
        ? failingTokenIds.has(tokenId)
          ? "error"
          : "complete"
        : tok.state === "waiting"
        ? "waiting"
        : "skipped";
    rows.push({
      nodeId: tok.nodeId,
      tokenId,
      state,
      summary: summariseState(state),
      preselected: false,
    });
  }

  // Determine preselection — the latest failing token by failureOrder, else
  // the oldest waiting token (lowest lastTransitionSeq).
  let preselectTokenId: string | null = null;
  if (failureOrder.length > 0) {
    preselectTokenId = failureOrder[failureOrder.length - 1]!;
  } else {
    let bestSeq = Number.POSITIVE_INFINITY;
    for (const wid of waitingTokenIds) {
      const s = lastTransitionSeq.get(wid) ?? Number.POSITIVE_INFINITY;
      if (s < bestSeq) {
        bestSeq = s;
        preselectTokenId = wid;
      }
    }
  }

  const withPre = rows.map((r) =>
    r.tokenId === preselectTokenId ? { ...r, preselected: true } : r,
  );

  // Sort: error → waiting → complete → skipped. Within each group, keep
  // insertion order (stable), which approximates the transition-time order
  // since `resolved` comes from a Map.
  const rank: Record<RerunNode["state"], number> = {
    error: 0,
    waiting: 1,
    complete: 2,
    skipped: 3,
  };
  const sorted = [...withPre].sort((a, b) => rank[a.state] - rank[b.state]);
  void info; // reserved for future status-aware ordering.
  return sorted;
}

/**
 * Project `workflow.inputs` + the originating `run:start` event into editable
 * rows. Keys in `run:start.inputs` that are NOT declared in `workflow.inputs`
 * are still surfaced (defensive).
 */
export function deriveInputRows(
  workflow: WorkflowDefinition,
  events: readonly EngineEvent[],
): readonly InputRow[] {
  let runStartInputs: Record<string, string> = {};
  for (const ev of events) {
    if (ev.type === "run:start") {
      runStartInputs = ev.inputs ?? {};
      break;
    }
  }
  const seen = new Set<string>();
  const rows: InputRow[] = [];
  for (const decl of workflow.inputs) {
    seen.add(decl.name);
    const original =
      runStartInputs[decl.name] !== undefined
        ? runStartInputs[decl.name]!
        : decl.default ?? "";
    rows.push({
      key: decl.name,
      original,
      draft: original,
      edited: false,
      required: decl.required,
    });
  }
  for (const [k, v] of Object.entries(runStartInputs)) {
    if (seen.has(k)) continue;
    rows.push({
      key: k,
      original: v,
      draft: v,
      edited: false,
      required: false,
    });
  }
  return rows;
}

/**
 * The single "failure site" node to preselect — nodeId of the most recent
 * failing `step:complete`, or the step whose token reached `"waiting"`
 * when status is suspended. Returns `null` for happy terminals.
 */
export function findFailingNode(
  info: RunInfo,
  events: readonly EngineEvent[],
): string | null {
  if (info.status !== "error" && info.status !== "suspended") return null;
  // Scan backwards for the most recent signal.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (
      e.type === "step:complete" &&
      e.result &&
      e.result.exit_code !== null &&
      e.result.exit_code !== 0
    ) {
      return e.nodeId;
    }
    if (e.type === "retry:exhausted") return e.nodeId;
  }
  if (info.status === "suspended") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i]!;
      if (e.type === "step:waiting") return e.nodeId;
    }
  }
  return null;
}

/** Boolean gate for `R` binding visibility. */
export function isRunResumable(info: RunInfo | null | undefined): boolean {
  if (!info) return false;
  return info.status === "error" || info.status === "suspended";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function summariseState(state: RerunNode["state"]): string {
  switch (state) {
    case "error":
      return "failed";
    case "waiting":
      return "waiting";
    case "complete":
      return "complete";
    case "skipped":
      return "skipped";
  }
}

/**
 * Minimal token reconstruction from an event stream — enough to populate the
 * wizard's rerun list when the caller has not supplied `handle.snapshot.tokens`.
 * Not a full replay; we only track (tokenId → {nodeId, state}).
 */
function reconstructTokens(events: readonly EngineEvent[]): Map<string, Token> {
  const out = new Map<string, Token>();
  for (const e of events) {
    if (e.type === "token:created") {
      out.set(e.tokenId, {
        id: e.tokenId,
        nodeId: e.nodeId,
        generation: e.generation,
        state: "pending",
      });
    } else if (e.type === "token:state") {
      const cur = out.get(e.tokenId);
      if (cur) out.set(e.tokenId, { ...cur, state: e.to });
    } else if (e.type === "token:reset") {
      const cur = out.get(e.tokenId);
      if (cur) out.set(e.tokenId, { ...cur, state: "pending" });
    } else if (e.type === "step:waiting") {
      const cur = out.get(e.tokenId);
      if (cur) out.set(e.tokenId, { ...cur, state: "waiting" });
    } else if (e.type === "step:complete") {
      const cur = out.get(e.tokenId);
      if (cur) out.set(e.tokenId, { ...cur, state: "complete" });
    }
  }
  return out;
}
