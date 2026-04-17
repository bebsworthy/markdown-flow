// test/log/select.test.ts

import { describe, it, expect } from "vitest";
import type { EngineEvent, Token } from "markflow";
import { resolveLogTarget } from "../../src/log/select.js";
import type { StepsSnapshot } from "../../src/steps/types.js";

function startEv(seq: number, tokenId: string, nodeId: string): EngineEvent {
  return {
    seq,
    ts: "2026-04-17T12:00:00Z",
    type: "step:start",
    nodeId,
    tokenId,
  } as EngineEvent;
}

function snapshotWithToken(tokenId: string, nodeId: string): StepsSnapshot {
  const tokens = new Map<string, Token>([
    [
      tokenId,
      {
        id: tokenId,
        nodeId,
        state: "running",
        generation: 0,
      } as Token,
    ],
  ]);
  return {
    tokens,
    retryBudgets: new Map(),
    completedResults: [],
    batches: new Map(),
  };
}

describe("resolveLogTarget", () => {
  it("returns no-selection when selection is null", () => {
    const r = resolveLogTarget(null, [], null);
    expect(r.exists).toBe(false);
    if (!r.exists) expect(r.reason.kind).toBe("no-selection");
  });

  it("returns aggregate when rowId starts with batch:", () => {
    const r = resolveLogTarget(null, [], { rowId: "batch:regions" });
    expect(r.exists).toBe(false);
    if (!r.exists) expect(r.reason.kind).toBe("aggregate");
  });

  it("resolves a running token via step:start", () => {
    const events = [startEv(42, "t-build", "build")];
    const r = resolveLogTarget(snapshotWithToken("t-build", "build"), events, {
      rowId: "t-build",
    });
    expect(r.exists).toBe(true);
    if (r.exists) {
      expect(r.stepSeq).toBe(42);
      expect(r.nodeId).toBe("build");
    }
  });

  it("returns pending when the token exists but step:start missing", () => {
    const r = resolveLogTarget(snapshotWithToken("t", "n"), [], { rowId: "t" });
    expect(r.exists).toBe(false);
    if (!r.exists) expect(r.reason.kind).toBe("pending");
  });

  it("returns not-found for unknown rowId", () => {
    const r = resolveLogTarget(snapshotWithToken("t", "n"), [], {
      rowId: "unknown",
    });
    expect(r.exists).toBe(false);
    if (!r.exists) expect(r.reason.kind).toBe("not-found");
  });

  it("tolerates a null snapshot", () => {
    const r = resolveLogTarget(null, [startEv(1, "t", "n")], { rowId: "t" });
    expect(r.exists).toBe(true);
  });
});
