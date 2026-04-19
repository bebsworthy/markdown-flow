// test/steps/aggregate.test.ts
//
// Unit tests for `src/steps/aggregate.ts` — forEach batch collapse + progress
// bar + NOTE suffix derivation. Mockup parity anchors:
//  - §4 running aggregate: "2 / 3   ██████░░░   1 retry · 0 failed"
//  - §6 terminal aggregate: "2 / 3   ██████░░░   1 ✗ · 0 ⏸"

import { describe, it, expect } from "vitest";
import type { BatchState, Token } from "markflow";
import {
  BATCH_COLLAPSE_THRESHOLD,
  DEFAULT_PROGRESS_BAR_WIDTH,
  aggregateBatchRow,
  deriveAggregateStatus,
  formatAggregateNote,
  formatProgressBar,
  shouldAggregateBatch,
  toBatchAggregate,
} from "../../src/steps/aggregate.js";
import { EMPTY_RETRY_HINTS } from "../../src/steps/retry.js";
import type {
  BatchAggregate,
  StepsSnapshot,
} from "../../src/steps/types.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");

function tok(overrides: Partial<Token> & { id: string }): Token {
  return {
    id: overrides.id,
    nodeId: overrides.nodeId ?? "fanout",
    generation: overrides.generation ?? 0,
    state: overrides.state ?? "running",
    edge: overrides.edge,
    result: overrides.result,
    batchId: overrides.batchId,
    itemIndex: overrides.itemIndex,
    parentTokenId: overrides.parentTokenId,
  };
}

function batch(overrides: Partial<BatchState> = {}): BatchState {
  return {
    nodeId: overrides.nodeId ?? "regions",
    expected: overrides.expected ?? 3,
    completed: overrides.completed ?? 0,
    succeeded: overrides.succeeded ?? 0,
    failed: overrides.failed ?? 0,
    onItemError: overrides.onItemError ?? "fail-fast",
    itemContexts: overrides.itemContexts ?? ["us-west-2", "eu-west-1", "ap-south-1"],
    results: overrides.results ?? [undefined, undefined, undefined],
    done: overrides.done ?? false,
    status: overrides.status,
  };
}

function snapshotFrom(tokens: Token[]): StepsSnapshot {
  return {
    tokens: new Map(tokens.map((t) => [t.id, t])),
    retryBudgets: new Map(),
    completedResults: [],
    batches: new Map(),
  };
}

describe("shouldAggregateBatch", () => {
  it("expected >= threshold → true", () => {
    expect(shouldAggregateBatch(batch({ expected: 2 }))).toBe(true);
    expect(shouldAggregateBatch(batch({ expected: 100 }))).toBe(true);
  });

  it("expected === 1 (below threshold) → false", () => {
    expect(shouldAggregateBatch(batch({ expected: 1 }))).toBe(false);
  });

  it("expected === 0 → false", () => {
    expect(shouldAggregateBatch(batch({ expected: 0 }))).toBe(false);
  });

  it("custom threshold respected", () => {
    expect(shouldAggregateBatch(batch({ expected: 3 }), 5)).toBe(false);
    expect(shouldAggregateBatch(batch({ expected: 5 }), 5)).toBe(true);
  });

  it("BATCH_COLLAPSE_THRESHOLD constant is 2", () => {
    expect(BATCH_COLLAPSE_THRESHOLD).toBe(2);
  });
});

describe("formatProgressBar", () => {
  it("width <= 0 → empty string", () => {
    expect(formatProgressBar(1, 3, 0)).toBe("");
    expect(formatProgressBar(1, 3, -4)).toBe("");
  });

  it("total <= 0 → empty string", () => {
    expect(formatProgressBar(0, 0, 9)).toBe("");
  });

  it("mockup §4 shape: 2 / 3 width 9 → 6 filled + 3 empty", () => {
    expect(formatProgressBar(2, 3, 9)).toBe("\u2588".repeat(6) + "\u2591".repeat(3));
  });

  it("fully complete → all filled", () => {
    expect(formatProgressBar(3, 3, 9)).toBe("\u2588".repeat(9));
  });

  it("clamps completed > total to full", () => {
    expect(formatProgressBar(10, 3, 9)).toBe("\u2588".repeat(9));
  });

  it("clamps negative completed to empty", () => {
    expect(formatProgressBar(-1, 3, 9)).toBe("\u2591".repeat(9));
  });

  it("caller-supplied glyphs override defaults (ASCII fallback)", () => {
    expect(formatProgressBar(2, 3, 9, "#", ".")).toBe("######...");
  });

  it("DEFAULT_PROGRESS_BAR_WIDTH is 9 (matches mockup §4)", () => {
    expect(DEFAULT_PROGRESS_BAR_WIDTH).toBe(9);
  });
});

describe("deriveAggregateStatus", () => {
  it("not done → 'running'", () => {
    expect(deriveAggregateStatus(batch({ done: false }))).toBe("running");
  });

  it("done + ok → 'complete'", () => {
    expect(
      deriveAggregateStatus(batch({ done: true, status: "ok" })),
    ).toBe("complete");
  });

  it("done + error → 'failed'", () => {
    expect(
      deriveAggregateStatus(batch({ done: true, status: "error" })),
    ).toBe("failed");
  });
});

describe("toBatchAggregate", () => {
  it("builds an aggregate for a running batch", () => {
    const b = batch({ expected: 3, completed: 2, succeeded: 2, failed: 0 });
    const tokens = [
      tok({
        id: "c1",
        batchId: "b1",
        itemIndex: 0,
        state: "complete",
        result: {
          node: "deploy",
          type: "script",
          edge: "success",
          summary: "",
          started_at: "2026-04-17T11:58:00Z",
          completed_at: "2026-04-17T11:58:30Z",
          exit_code: 0,
        },
      }),
    ];
    const snap = snapshotFrom(tokens);
    const agg = toBatchAggregate(b, "b1", snap, EMPTY_RETRY_HINTS);
    expect(agg.batchId).toBe("b1");
    expect(agg.nodeId).toBe("regions");
    expect(agg.label).toContain("batch [regions]");
    expect(agg.expected).toBe(3);
    expect(agg.completed).toBe(2);
    expect(agg.status).toBe("running");
    expect(agg.earliestStartedAt).toBe("2026-04-17T11:58:00Z");
  });

  it("counts in-flight retries from hints map", () => {
    const b = batch({ expected: 3, completed: 1 });
    const tokens = [
      tok({ id: "c1", batchId: "b1", state: "running" }),
      tok({ id: "c2", batchId: "b1", state: "running" }),
      tok({ id: "c3", batchId: "b1", state: "running" }),
    ];
    const snap = snapshotFrom(tokens);
    const hints = new Map([
      [
        "c1",
        {
          tokenId: "c1",
          nodeId: "regions",
          attempt: 2,
          scheduledAtMs: NOW,
          delayMs: 1000,
          reason: "fail" as const,
        },
      ],
    ]);
    const agg = toBatchAggregate(b, "b1", snap, hints);
    expect(agg.retries).toBe(1);
  });
});

describe("formatAggregateNote", () => {
  const running: BatchAggregate = {
    batchId: "b1",
    nodeId: "regions",
    label: "batch [regions]",
    expected: 3,
    completed: 2,
    succeeded: 2,
    failed: 0,
    retries: 1,
    status: "running",
    earliestStartedAt: "2026-04-17T11:58:00Z",
  };

  it("running → '2 / 3   ██████░░░   1 retry · 0 failed' (mockup §4)", () => {
    expect(formatAggregateNote(running)).toBe(
      "2 / 3   \u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2591\u2591   1 retry \u00b7 0 failed",
    );
  });

  it("running with retries=2 → pluralises 'retries'", () => {
    expect(formatAggregateNote({ ...running, retries: 2 })).toContain("2 retries");
  });

  it("running with retries=0 → pluralises '0 retries'", () => {
    expect(formatAggregateNote({ ...running, retries: 0 })).toContain("0 retries");
  });

  it("failed → '2 / 3   ██████░░░   1 ✗ · 0 ⏸' (mockup §6)", () => {
    const failed: BatchAggregate = {
      ...running,
      completed: 3,
      succeeded: 2,
      failed: 1,
      retries: 0,
      status: "failed",
    };
    expect(formatAggregateNote(failed)).toBe(
      "3 / 3   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588   1 \u2717 \u00b7 0 \u23f8",
    );
  });

  it("complete + ok → no retry suffix (clean terminal display)", () => {
    const ok: BatchAggregate = {
      ...running,
      completed: 3,
      succeeded: 3,
      failed: 0,
      retries: 0,
      status: "complete",
    };
    const note = formatAggregateNote(ok);
    expect(note).toBe("3 / 3   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588");
  });
});

describe("aggregateBatchRow", () => {
  it("builds a StepRow with kind='batch-aggregate'", () => {
    const tokens = [
      tok({
        id: "c1",
        batchId: "b1",
        itemIndex: 0,
        state: "complete",
        result: {
          node: "deploy",
          type: "script",
          edge: "success",
          summary: "",
          started_at: "2026-04-17T11:58:00Z",
          completed_at: "2026-04-17T11:58:30Z",
          exit_code: 0,
        },
      }),
    ];
    const snap = snapshotFrom(tokens);
    const row = aggregateBatchRow(
      batch({ expected: 3, completed: 1, succeeded: 1 }),
      "b1",
      0,
      snap,
      EMPTY_RETRY_HINTS,
      NOW,
    );
    expect(row.kind).toBe("batch-aggregate");
    expect(row.id).toBe("batch:b1");
    expect(row.depth).toBe(0);
    expect(row.attempt).toBe("\u2014");
    expect(row.status).toBe("running");
    expect(row.glyphKey).toBe("batch");
    expect(row.aggregate).toBeDefined();
    expect(row.aggregate!.completed).toBe(1);
    expect(row.aggregate!.expected).toBe(3);
  });

  it("elapsed uses now - earliest start for in-flight batch", () => {
    const start = "2026-04-17T11:59:00Z";
    const tokens = [
      tok({
        id: "c1",
        batchId: "b1",
        state: "running",
        result: {
          node: "deploy",
          type: "script",
          edge: "",
          summary: "",
          started_at: start,
          completed_at: start,
          exit_code: null,
        },
      }),
    ];
    const snap = snapshotFrom(tokens);
    const row = aggregateBatchRow(
      batch({ expected: 3, completed: 0 }),
      "b1",
      0,
      snap,
      EMPTY_RETRY_HINTS,
      NOW,
    );
    // NOW - start = 60000 ms → "1m00s".
    expect(row.elapsedMs).toBe(60_000);
    expect(row.elapsed).toBe("1m00s");
  });

  it("done batch uses max completed_at - earliest started_at", () => {
    const start = "2026-04-17T11:58:00Z";
    const midEnd = "2026-04-17T11:58:20Z";
    const lateEnd = "2026-04-17T11:58:45Z";
    const tokens = [
      tok({
        id: "c1",
        batchId: "b1",
        state: "complete",
        result: {
          node: "deploy",
          type: "script",
          edge: "success",
          summary: "",
          started_at: start,
          completed_at: midEnd,
          exit_code: 0,
        },
      }),
      tok({
        id: "c2",
        batchId: "b1",
        state: "complete",
        result: {
          node: "deploy",
          type: "script",
          edge: "success",
          summary: "",
          started_at: start,
          completed_at: lateEnd,
          exit_code: 0,
        },
      }),
    ];
    const snap = snapshotFrom(tokens);
    const row = aggregateBatchRow(
      batch({
        expected: 2,
        completed: 2,
        succeeded: 2,
        done: true,
        status: "ok",
      }),
      "b1",
      0,
      snap,
      EMPTY_RETRY_HINTS,
      NOW,
    );
    expect(row.elapsedMs).toBe(45_000);
    expect(row.status).toBe("complete");
  });
});
