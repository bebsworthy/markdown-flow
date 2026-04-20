// src/approval/derive.ts
//
// Pure projections that extract pending approvals from an engine event tail.
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Registered in
// test/state/purity.test.ts.

import type { EngineEvent, RunInfo } from "markflow-cli";
import type { LiveRunSnapshot } from "../engine/types.js";
import type { PendingApproval } from "./types.js";

/**
 * Scan an event tail (oldest-first order in the ring) for open approval
 * gates. A gate is "open" if a `step:waiting` for `(nodeId, tokenId)` is NOT
 * followed by an `approval:decided` for the same `(nodeId, tokenId)`.
 *
 * Fast-path: when `info.status` is neither "running" nor "suspended", the
 * run cannot have an open gate so we short-circuit with an empty array.
 *
 * Deterministic, O(n).
 */
export function derivePendingApprovals(
  events: readonly EngineEvent[],
  info?: RunInfo | null,
): readonly PendingApproval[] {
  if (info && info.status !== "running" && info.status !== "suspended") {
    return [];
  }
  // nodeId|tokenId → latest waiting
  const open = new Map<string, PendingApproval>();
  for (const ev of events) {
    if (ev.type === "step:waiting") {
      const key = `${ev.nodeId}|${ev.tokenId}`;
      open.set(key, {
        runId: info?.id ?? "",
        nodeId: ev.nodeId,
        tokenId: ev.tokenId,
        prompt: ev.prompt,
        options: ev.options.slice(),
        waitingSeq: ev.seq,
      });
    } else if (ev.type === "approval:decided") {
      const key = `${ev.nodeId}|${ev.tokenId}`;
      open.delete(key);
    }
  }
  if (open.size === 0) return [];
  return [...open.values()].sort((a, b) => a.waitingSeq - b.waitingSeq);
}

/**
 * Pending-count per known run. Uses `RunInfo.status` as a cheap first-pass
 * filter; for the currently-tailed `activeRun`, scans the ring buffer for a
 * precise count. For non-active runs, a coarse `status === "suspended" ? 1
 * : 0` is used — the TUI cannot see per-run prompts without a file read.
 *
 * See docs/tui/plans/P7-T1.md §4 D3.
 */
export function countPendingApprovalsByRun(
  runs: ReadonlyMap<string, RunInfo>,
  activeRun: LiveRunSnapshot | null,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [id, info] of runs) {
    if (activeRun && activeRun.runId === id) {
      const pending = derivePendingApprovals(activeRun.events, info);
      out.set(id, pending.length);
      continue;
    }
    out.set(id, info.status === "suspended" ? 1 : 0);
  }
  // Edge case: activeRun may not yet be present in runs map.
  if (activeRun && !out.has(activeRun.runId)) {
    const pending = derivePendingApprovals(activeRun.events, activeRun.info);
    out.set(activeRun.runId, pending.length);
  }
  return out;
}

/**
 * Pick the next pending approval to surface (lowest `waitingSeq`, stable).
 * When `nodeId` is supplied, narrow to gates on that node.
 */
export function findPendingApproval(
  events: readonly EngineEvent[],
  nodeId?: string,
): PendingApproval | null {
  const all = derivePendingApprovals(events);
  const candidates = nodeId
    ? all.filter((a) => a.nodeId === nodeId)
    : all;
  return candidates[0] ?? null;
}
