import { describe, it, expect } from "vitest";
import { replay } from "../../src/core/replay.js";
import {
  InconsistentLogError,
  UnsupportedLogVersionError,
  type EngineEvent,
  type EngineEventPayload,
  type StepResult,
  type MarkflowConfig,
} from "../../src/core/types.js";

const DEFAULT_CFG: MarkflowConfig = {
  agent: "claude",
  agentFlags: [],
  parallel: false,
};

function stamp(events: EngineEventPayload[]): EngineEvent[] {
  return events.map(
    (e, i) =>
      ({
        ...e,
        seq: i + 1,
        ts: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      }) as EngineEvent,
  );
}

const runStart = {
  type: "run:start" as const,
  v: 1 as const,
  runId: "r1",
  workflowName: "T",
  sourceFile: "t.md",
  inputs: {},
  configResolved: DEFAULT_CFG,
};

describe("replay fold", () => {
  it("returns an empty running snapshot for an empty log", () => {
    const snap = replay([]);
    expect(snap.status).toBe("running");
    expect(snap.tokens.size).toBe(0);
    expect(snap.completedResults).toEqual([]);
    expect(snap.globalContext).toEqual({});
    expect(snap.retryBudgets.size).toBe(0);
  });

  it("assembles a token from token:created", () => {
    const snap = replay(
      stamp([
        runStart,
        { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 },
      ]),
    );
    expect(snap.tokens.get("t1")).toEqual({
      id: "t1",
      nodeId: "a",
      generation: 0,
      state: "pending",
    });
  });

  it("applies token:state transitions", () => {
    const snap = replay(
      stamp([
        runStart,
        { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 },
        { type: "token:state", tokenId: "t1", from: "pending", to: "running" },
      ]),
    );
    expect(snap.tokens.get("t1")!.state).toBe("running");
  });

  it("attaches edge and result to the just-completed token on step:complete", () => {
    const result: StepResult = {
      node: "a",
      type: "script",
      edge: "next",
      summary: "",
      started_at: "t0",
      completed_at: "t1",
      exit_code: 0,
    };
    const snap = replay(
      stamp([
        runStart,
        { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 },
        { type: "token:state", tokenId: "t1", from: "pending", to: "running" },
        { type: "step:start", nodeId: "a", tokenId: "t1" },
        {
          type: "token:state",
          tokenId: "t1",
          from: "running",
          to: "complete",
        },
        { type: "step:complete", nodeId: "a", tokenId: "t1", result },
      ]),
    );
    expect(snap.completedResults).toEqual([result]);
    expect(snap.tokens.get("t1")!.edge).toBe("next");
    expect(snap.tokens.get("t1")!.result).toEqual(result);
  });

  it("merges global:update patches in order (later keys win)", () => {
    const snap = replay(
      stamp([
        runStart,
        { type: "global:update", keys: ["a"], patch: { a: 1 } },
        { type: "global:update", keys: ["a", "b"], patch: { a: 2, b: 3 } },
      ]),
    );
    expect(snap.globalContext).toEqual({ a: 2, b: 3 });
  });

  it("stores retry budgets keyed by nodeId:label", () => {
    const snap = replay(
      stamp([
        runStart,
        {
          type: "retry:increment",
          nodeId: "n",
          label: "fail",
          count: 1,
          max: 2,
        },
        {
          type: "retry:increment",
          nodeId: "n",
          label: "fail",
          count: 2,
          max: 2,
        },
      ]),
    );
    expect(snap.retryBudgets.get("n:fail")).toEqual({ count: 2, max: 2 });
  });

  it("transitions status on workflow:complete", () => {
    const snap = replay(
      stamp([runStart, { type: "workflow:complete", results: [] }]),
    );
    expect(snap.status).toBe("complete");
  });

  it("transitions status on workflow:error", () => {
    const snap = replay(
      stamp([runStart, { type: "workflow:error", error: "boom" }]),
    );
    expect(snap.status).toBe("error");
  });

  it("throws InconsistentLogError on out-of-order seq", () => {
    const bad: EngineEvent[] = [
      { ...runStart, seq: 3, ts: "t" },
      { ...runStart, seq: 2, ts: "t" },
    ];
    expect(() => replay(bad)).toThrow(InconsistentLogError);
  });

  it("tolerates seq gaps from non-persisted events", () => {
    // seq=2 may have been a step:output that never reached disk.
    const ok: EngineEvent[] = [
      { ...runStart, seq: 1, ts: "t" },
      {
        type: "token:created",
        tokenId: "t1",
        nodeId: "a",
        generation: 0,
        seq: 3,
        ts: "t",
      },
    ];
    const snap = replay(ok);
    expect(snap.tokens.get("t1")).toBeDefined();
  });

  it("throws InconsistentLogError on token:state for unknown token", () => {
    expect(() =>
      replay(
        stamp([
          runStart,
          {
            type: "token:state",
            tokenId: "ghost",
            from: "pending",
            to: "running",
          },
        ]),
      ),
    ).toThrow(InconsistentLogError);
  });

  it("throws InconsistentLogError on token:state with wrong from-state", () => {
    expect(() =>
      replay(
        stamp([
          runStart,
          { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 },
          // token is "pending", but event says from="running"
          {
            type: "token:state",
            tokenId: "t1",
            from: "running",
            to: "complete",
          },
        ]),
      ),
    ).toThrow(InconsistentLogError);
  });

  it("throws UnsupportedLogVersionError on run:start with wrong v", () => {
    const bad = [
      { ...runStart, v: 2 as unknown as 1, seq: 1, ts: "t" },
    ] as EngineEvent[];
    expect(() => replay(bad)).toThrow(UnsupportedLogVersionError);
  });

  it("throws InconsistentLogError on duplicate run:start", () => {
    expect(() =>
      replay(stamp([runStart, runStart])),
    ).toThrow(InconsistentLogError);
  });

  it("throws InconsistentLogError on token:created for existing token", () => {
    expect(() =>
      replay(
        stamp([
          runStart,
          { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 },
          { type: "token:created", tokenId: "t1", nodeId: "b", generation: 0 },
        ]),
      ),
    ).toThrow(InconsistentLogError);
  });

  it("rejects step:output in the persisted log", () => {
    expect(() =>
      replay(
        stamp([
          runStart,
          {
            type: "step:output",
            nodeId: "a",
            stream: "stdout",
            chunk: "x",
          },
        ]),
      ),
    ).toThrow(InconsistentLogError);
  });
});
