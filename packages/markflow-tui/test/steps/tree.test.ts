// test/steps/tree.test.ts
//
// Unit tests for `src/steps/tree.ts` — buildStepRows + indexByParent +
// orderRoots + projectStepsSnapshot.

import { describe, it, expect } from "vitest";
import type {
  BatchState,
  EngineEvent,
  RunInfo,
  StepResult,
  Token,
} from "markflow";
import {
  buildStepRows,
  indexByParent,
  orderRoots,
  projectStepsSnapshot,
} from "../../src/steps/tree.js";
import { EMPTY_RETRY_HINTS } from "../../src/steps/retry.js";
import type { StepsSnapshot } from "../../src/steps/types.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");

function tok(overrides: Partial<Token> & { id: string }): Token {
  return {
    id: overrides.id,
    nodeId: overrides.nodeId ?? "node",
    generation: overrides.generation ?? 0,
    state: overrides.state ?? "pending",
    edge: overrides.edge,
    result: overrides.result,
    batchId: overrides.batchId,
    itemIndex: overrides.itemIndex,
    parentTokenId: overrides.parentTokenId,
  };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "node",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "success",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T11:59:00Z",
    completed_at: overrides.completed_at ?? "2026-04-17T11:59:10Z",
    exit_code: overrides.exit_code ?? 0,
  };
}

function snapshotOf(
  tokens: Token[],
  batches: Array<[string, BatchState]> = [],
): StepsSnapshot {
  return {
    tokens: new Map(tokens.map((t) => [t.id, t])),
    retryBudgets: new Map(),
    completedResults: [],
    batches: new Map(batches),
  };
}

describe("indexByParent", () => {
  it("groups children by parentTokenId and sorts by started_at asc", () => {
    const tokens = [
      tok({ id: "p1" }),
      tok({
        id: "c2",
        parentTokenId: "p1",
        result: result({ started_at: "2026-04-17T11:59:10Z" }),
      }),
      tok({
        id: "c1",
        parentTokenId: "p1",
        result: result({ started_at: "2026-04-17T11:59:00Z" }),
      }),
      tok({ id: "orphan" }),
    ];
    const map = indexByParent(new Map(tokens.map((t) => [t.id, t])));
    const kids = map.get("p1")!;
    expect(kids.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(map.has("orphan")).toBe(false);
  });

  it("ties broken by itemIndex then tokenId", () => {
    const ts = "2026-04-17T11:59:00Z";
    const tokens = [
      tok({
        id: "b",
        parentTokenId: "p",
        itemIndex: 1,
        result: result({ started_at: ts }),
      }),
      tok({
        id: "a",
        parentTokenId: "p",
        itemIndex: 0,
        result: result({ started_at: ts }),
      }),
    ];
    const kids = indexByParent(new Map(tokens.map((t) => [t.id, t]))).get("p")!;
    expect(kids.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("children with no started_at come after those with one", () => {
    const tokens = [
      tok({ id: "no-start", parentTokenId: "p" }),
      tok({
        id: "has-start",
        parentTokenId: "p",
        result: result({ started_at: "2026-04-17T11:59:00Z" }),
      }),
    ];
    const kids = indexByParent(new Map(tokens.map((t) => [t.id, t]))).get("p")!;
    expect(kids.map((t) => t.id)).toEqual(["has-start", "no-start"]);
  });
});

describe("orderRoots", () => {
  it("single-root path is returned verbatim", () => {
    const snap = snapshotOf([tok({ id: "r1", state: "running" })]);
    const roots = orderRoots(snap, null);
    expect(roots.map((t) => t.id)).toEqual(["r1"]);
  });

  it("completed roots ordered by info.steps completion index", () => {
    const ra = tok({
      id: "ra",
      nodeId: "build",
      state: "complete",
      result: result({ node: "build" }),
    });
    const rb = tok({
      id: "rb",
      nodeId: "test",
      state: "complete",
      result: result({ node: "test" }),
    });
    const rc = tok({ id: "rc", nodeId: "deploy", state: "running" });
    // Build snapshot such that insertion order is rc, rb, ra but info.steps
    // reports completion order test (0) then build (1).
    const snap = snapshotOf([rc, rb, ra]);
    const info: RunInfo = {
      id: "r1",
      workflowName: "w",
      sourceFile: ".",
      status: "running",
      startedAt: "2026-04-17T11:58:00Z",
      steps: [result({ node: "test" }), result({ node: "build" })],
    };
    const roots = orderRoots(snap, info);
    expect(roots.map((t) => t.id)).toEqual(["rb", "ra", "rc"]);
  });
});

describe("buildStepRows", () => {
  it("empty snapshot → empty rows", () => {
    const rows = buildStepRows(snapshotOf([]), null, NOW, EMPTY_RETRY_HINTS);
    expect(rows).toHaveLength(0);
  });

  it("single leaf token → one row, depth 0", () => {
    const rows = buildStepRows(
      snapshotOf([tok({ id: "t1", state: "running", nodeId: "build" })]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[0]!.label).toBe("build");
    expect(rows[0]!.status).toBe("running");
    expect(rows[0]!.kind).toBe("leaf");
  });

  it("parent + two children render depth-first with depth+1 children", () => {
    const tokens = [
      tok({ id: "p", nodeId: "fanout", state: "running" }),
      tok({
        id: "c1",
        nodeId: "a",
        parentTokenId: "p",
        state: "running",
        result: result({ started_at: "2026-04-17T11:59:00Z" }),
      }),
      tok({
        id: "c2",
        nodeId: "b",
        parentTokenId: "p",
        state: "running",
        result: result({ started_at: "2026-04-17T11:59:05Z" }),
      }),
    ];
    const rows = buildStepRows(snapshotOf(tokens), null, NOW, EMPTY_RETRY_HINTS);
    expect(rows.map((r) => [r.label, r.depth])).toEqual([
      ["fanout", 0],
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("skipped child of failed parent → note 'upstream failed'", () => {
    const parent = tok({
      id: "p",
      state: "complete",
      nodeId: "fanout",
      result: result({ edge: "fail", exit_code: 1 }),
    });
    const skipped = tok({
      id: "c",
      parentTokenId: "p",
      state: "skipped",
      nodeId: "deploy-ap",
    });
    const rows = buildStepRows(
      snapshotOf([parent, skipped]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    const skRow = rows.find((r) => r.label === "deploy-ap")!;
    expect(skRow.status).toBe("skipped");
    expect(skRow.note).toBe("upstream failed");
  });

  it("forEach batch at threshold collapses into a single aggregate row", () => {
    const parent = tok({ id: "fan", state: "complete", nodeId: "regions" });
    const members = [0, 1, 2].map((i) =>
      tok({
        id: `c${i}`,
        nodeId: "deploy",
        parentTokenId: "fan",
        batchId: "b1",
        itemIndex: i,
        state: "running",
        result: result({ started_at: "2026-04-17T11:59:00Z" }),
      }),
    );
    const batch: BatchState = {
      nodeId: "regions",
      expected: 3,
      completed: 1,
      succeeded: 1,
      failed: 0,
      onItemError: "fail-fast",
      itemContexts: ["us", "eu", "ap"],
      results: [undefined, undefined, undefined],
      done: false,
    };
    const rows = buildStepRows(
      snapshotOf([parent, ...members], [["b1", batch]]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    // One parent row, then exactly one aggregate row (not three leaves).
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("leaf");
    expect(rows[1]!.kind).toBe("batch-aggregate");
    expect(rows[1]!.id).toBe("batch:b1");
    expect(rows[1]!.depth).toBe(1);
  });

  it("sub-threshold batch (expected=1) renders as individual leaves", () => {
    const parent = tok({ id: "fan", state: "complete" });
    const child = tok({
      id: "c0",
      parentTokenId: "fan",
      batchId: "b1",
      itemIndex: 0,
      state: "running",
      nodeId: "deploy",
    });
    const batch: BatchState = {
      nodeId: "deploy",
      expected: 1,
      completed: 0,
      succeeded: 0,
      failed: 0,
      onItemError: "fail-fast",
      itemContexts: ["only"],
      results: [undefined],
      done: false,
    };
    const rows = buildStepRows(
      snapshotOf([parent, child], [["b1", batch]]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    expect(rows.map((r) => r.kind)).toEqual(["leaf", "leaf"]);
  });

  it("custom collapseThreshold gates aggregation", () => {
    const parent = tok({ id: "fan", state: "complete" });
    const members = [0, 1, 2].map((i) =>
      tok({
        id: `c${i}`,
        parentTokenId: "fan",
        batchId: "b1",
        itemIndex: i,
        state: "running",
        nodeId: "deploy",
      }),
    );
    const batch: BatchState = {
      nodeId: "deploy",
      expected: 3,
      completed: 0,
      succeeded: 0,
      failed: 0,
      onItemError: "fail-fast",
      itemContexts: ["a", "b", "c"],
      results: [undefined, undefined, undefined],
      done: false,
    };
    const rows = buildStepRows(
      snapshotOf([parent, ...members], [["b1", batch]]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
      { collapseThreshold: 10 },
    );
    // Threshold 10 means 3-item batch should NOT aggregate.
    expect(rows.map((r) => r.kind)).toEqual([
      "leaf",
      "leaf",
      "leaf",
      "leaf",
    ]);
  });

  it("retry hint on a running token → note starts with ↻ countdown", () => {
    const started = "2026-04-17T11:59:50Z";
    const running = tok({
      id: "t1",
      state: "running",
      nodeId: "deploy",
      result: result({ started_at: started }),
    });
    const rows = buildStepRows(
      snapshotOf([running]),
      null,
      NOW,
      new Map([
        [
          "t1",
          {
            tokenId: "t1",
            nodeId: "deploy",
            attempt: 2,
            scheduledAtMs: NOW - 1_000,
            delayMs: 5_000,
            reason: "fail",
          },
        ],
      ]),
    );
    expect(rows[0]!.status).toBe("retrying");
    expect(rows[0]!.note).toContain("retrying in 4.0s");
    expect(rows[0]!.note.startsWith("\u21bb")).toBe(true);
  });

  it("complete token with edge='success' → note '→ next'", () => {
    const complete = tok({
      id: "t1",
      state: "complete",
      nodeId: "build",
      result: result({ edge: "success" }),
    });
    const rows = buildStepRows(
      snapshotOf([complete]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    expect(rows[0]!.status).toBe("complete");
    expect(rows[0]!.note).toBe("\u2192 next");
  });

  it("complete + fail:max → note 'retries exhausted ...'", () => {
    const failed = tok({
      id: "t1",
      state: "complete",
      nodeId: "deploy",
      result: result({ edge: "fail:max", exit_code: 1 }),
    });
    const rows = buildStepRows(
      snapshotOf([failed]),
      null,
      NOW,
      EMPTY_RETRY_HINTS,
    );
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.note).toContain("retries exhausted");
  });
});

describe("projectStepsSnapshot", () => {
  const baseEnv = { seq: 0, ts: "2026-04-17T11:59:00Z" } as const;

  it("empty events → empty snapshot, but completedResults from info.steps", () => {
    const info: RunInfo = {
      id: "r1",
      workflowName: "w",
      sourceFile: ".",
      status: "running",
      startedAt: "2026-04-17T11:59:00Z",
      steps: [result({ node: "build" })],
    };
    const snap = projectStepsSnapshot([], info);
    expect(snap.tokens.size).toBe(0);
    expect(snap.batches.size).toBe(0);
    expect(snap.completedResults).toHaveLength(1);
  });

  it("token:created → inserts a pending token", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.tokens.get("t1")!.state).toBe("pending");
    expect(snap.tokens.get("t1")!.nodeId).toBe("build");
  });

  it("token:state transitions existing token", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
      {
        ...baseEnv,
        seq: 2,
        ts: "2026-04-17T11:59:01Z",
        type: "token:state",
        tokenId: "t1",
        from: "pending",
        to: "running",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.tokens.get("t1")!.state).toBe("running");
  });

  it("token:state for unknown tokenId is a no-op", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "token:state",
        tokenId: "ghost",
        from: "pending",
        to: "running",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.tokens.size).toBe(0);
  });

  it("step:start → running + seeds a result with started_at", () => {
    const ts = "2026-04-17T11:59:05Z";
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
      {
        ...baseEnv,
        seq: 2,
        ts,
        type: "step:start",
        nodeId: "build",
        tokenId: "t1",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    const t = snap.tokens.get("t1")!;
    expect(t.state).toBe("running");
    expect(t.result?.started_at).toBe(ts);
  });

  it("step:complete → state 'complete' + result + edge", () => {
    const r = result({ edge: "fail", exit_code: 1 });
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "token:created",
        tokenId: "t1",
        nodeId: "build",
        generation: 0,
      } as EngineEvent,
      {
        ...baseEnv,
        seq: 2,
        type: "step:complete",
        nodeId: "build",
        tokenId: "t1",
        result: r,
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.tokens.get("t1")!.state).toBe("complete");
    expect(snap.tokens.get("t1")!.edge).toBe("fail");
    expect(snap.tokens.get("t1")!.result).toEqual(r);
  });

  it("retry:increment → fills retryBudgets keyed 'node:label'", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "retry:increment",
        nodeId: "deploy",
        label: "fail",
        count: 1,
        max: 3,
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.retryBudgets.get("deploy:fail")).toEqual({ count: 1, max: 3 });
  });

  it("batch:start then batch:item:complete advance the batch counters", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "batch:start",
        v: 2,
        batchId: "b1",
        nodeId: "regions",
        items: 3,
        itemContexts: ["a", "b", "c"],
        onItemError: "fail-fast",
      } as EngineEvent,
      {
        ...baseEnv,
        seq: 2,
        type: "batch:item:complete",
        v: 2,
        batchId: "b1",
        itemIndex: 0,
        tokenId: "t0",
        ok: true,
        edge: "success",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    const b = snap.batches.get("b1")!;
    expect(b.expected).toBe(3);
    expect(b.completed).toBe(1);
    expect(b.succeeded).toBe(1);
    expect(b.failed).toBe(0);
    expect(b.done).toBe(false);
  });

  it("batch:complete marks done and final counts", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "batch:start",
        v: 2,
        batchId: "b1",
        nodeId: "regions",
        items: 2,
        itemContexts: ["a", "b"],
        onItemError: "fail-fast",
      } as EngineEvent,
      {
        ...baseEnv,
        seq: 2,
        type: "batch:complete",
        v: 2,
        batchId: "b1",
        succeeded: 1,
        failed: 1,
        status: "error",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    const b = snap.batches.get("b1")!;
    expect(b.done).toBe(true);
    expect(b.status).toBe("error");
    expect(b.failed).toBe(1);
    expect(b.succeeded).toBe(1);
  });

  it("unknown event types are no-ops (ring-buffer-tolerant)", () => {
    const events: EngineEvent[] = [
      {
        ...baseEnv,
        seq: 1,
        type: "route",
        from: "a",
        to: "b",
      } as EngineEvent,
    ];
    const snap = projectStepsSnapshot(events, null);
    expect(snap.tokens.size).toBe(0);
    expect(snap.batches.size).toBe(0);
  });
});
