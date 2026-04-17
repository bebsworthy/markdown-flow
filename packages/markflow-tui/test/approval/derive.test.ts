// test/approval/derive.test.ts
//
// Unit tests for the pure approval derivations (P7-T1).

import { describe, it, expect } from "vitest";
import type { EngineEvent, RunInfo } from "markflow";
import {
  derivePendingApprovals,
  countPendingApprovalsByRun,
  findPendingApproval,
} from "../../src/approval/derive.js";
import type { LiveRunSnapshot } from "../../src/engine/types.js";

function waiting(
  seq: number,
  nodeId: string,
  tokenId: string,
  prompt = "?",
  options: readonly string[] = ["approve", "reject"],
): EngineEvent {
  return {
    type: "step:waiting",
    v: 1,
    nodeId,
    tokenId,
    prompt,
    options: [...options],
    seq,
    ts: new Date(seq * 1000).toISOString(),
  };
}

function decided(
  seq: number,
  nodeId: string,
  tokenId: string,
  choice = "approve",
): EngineEvent {
  return {
    type: "approval:decided",
    v: 1,
    nodeId,
    tokenId,
    choice,
    decidedAt: new Date(seq * 1000).toISOString(),
    seq,
    ts: new Date(seq * 1000).toISOString(),
  };
}

function info(
  id: string,
  status: RunInfo["status"] = "suspended",
): RunInfo {
  return {
    id,
    workflowName: `wf-${id}`,
    sourceFile: `./${id}.md`,
    status,
    startedAt: "2026-01-01T00:00:00Z",
    steps: [],
  };
}

describe("derivePendingApprovals", () => {
  it("returns one entry for an open waiting gate", () => {
    const ev: readonly EngineEvent[] = [waiting(1, "review", "t1")];
    const out = derivePendingApprovals(ev, info("r1"));
    expect(out).toHaveLength(1);
    expect(out[0]!.nodeId).toBe("review");
    expect(out[0]!.tokenId).toBe("t1");
    expect(out[0]!.waitingSeq).toBe(1);
    expect(out[0]!.runId).toBe("r1");
    expect(out[0]!.options).toEqual(["approve", "reject"]);
  });

  it("returns zero when decided after waiting for same token", () => {
    const ev: readonly EngineEvent[] = [
      waiting(1, "review", "t1"),
      decided(2, "review", "t1"),
    ];
    expect(derivePendingApprovals(ev, info("r1"))).toHaveLength(0);
  });

  it("orders concurrent gates by waitingSeq", () => {
    const ev: readonly EngineEvent[] = [
      waiting(3, "n2", "tB"),
      waiting(1, "n1", "tA"),
    ];
    const out = derivePendingApprovals(ev, info("r1"));
    expect(out.map((p) => p.waitingSeq)).toEqual([1, 3]);
  });

  it("a decision for a different tokenId leaves the original open", () => {
    const ev: readonly EngineEvent[] = [
      waiting(1, "review", "t1"),
      decided(2, "review", "t2"),
    ];
    const out = derivePendingApprovals(ev, info("r1"));
    expect(out).toHaveLength(1);
    expect(out[0]!.tokenId).toBe("t1");
  });

  it("ring eviction truncates older decision → gate looks open (documented)", () => {
    // Only the waiting event remains in the ring (decision has been evicted);
    // derive treats it as open.
    const ev: readonly EngineEvent[] = [waiting(1, "n", "t1")];
    const out = derivePendingApprovals(ev, info("r"));
    expect(out).toHaveLength(1);
  });

  it("fast-paths to [] when info.status is terminal", () => {
    const ev: readonly EngineEvent[] = [waiting(1, "n", "t1")];
    expect(derivePendingApprovals(ev, info("r", "complete"))).toEqual([]);
    expect(derivePendingApprovals(ev, info("r", "error"))).toEqual([]);
  });

  it("findPendingApproval narrows by nodeId when given", () => {
    const ev: readonly EngineEvent[] = [
      waiting(1, "a", "tA"),
      waiting(2, "b", "tB"),
    ];
    expect(findPendingApproval(ev)?.nodeId).toBe("a");
    expect(findPendingApproval(ev, "b")?.nodeId).toBe("b");
    expect(findPendingApproval(ev, "missing")).toBeNull();
  });
});

describe("countPendingApprovalsByRun", () => {
  it("returns exact count for the active run and coarse signal for others", () => {
    const runs = new Map<string, RunInfo>([
      ["r1", info("r1", "suspended")],
      ["r2", info("r2", "running")],
      ["r3", info("r3", "complete")],
    ]);
    const active: LiveRunSnapshot = {
      runId: "r1",
      info: info("r1", "suspended"),
      events: [waiting(1, "n1", "t1"), waiting(2, "n2", "t2")],
      lastSeq: 2,
      terminal: false,
    };
    const out = countPendingApprovalsByRun(runs, active);
    expect(out.get("r1")).toBe(2); // exact
    expect(out.get("r2")).toBe(0); // running but no sidecar read
    expect(out.get("r3")).toBe(0); // complete
  });

  it("no active run leaves every run coarse", () => {
    const runs = new Map<string, RunInfo>([
      ["r1", info("r1", "suspended")],
      ["r2", info("r2", "complete")],
    ]);
    const out = countPendingApprovalsByRun(runs, null);
    expect(out.get("r1")).toBe(1);
    expect(out.get("r2")).toBe(0);
  });
});
