import { describe, it, expect } from "vitest";
import { tokensByBatch } from "../../src/core/queries.js";
import type { EngineSnapshot, Token } from "../../src/core/types.js";

function makeSnapshot(tokens: Token[]): EngineSnapshot {
  return {
    tokens: new Map(tokens.map((t) => [t.id, t])),
    retryBudgets: new Map(),
    globalContext: {},
    completedResults: [],
    status: "running",
    batches: new Map(),
  };
}

function makeToken(id: string, batchId?: string): Token {
  return {
    id,
    nodeId: "n",
    generation: 0,
    state: "pending",
    batchId,
  };
}

describe("tokensByBatch", () => {
  it("returns children of a known batch id", () => {
    const snap = makeSnapshot([
      makeToken("t1", "B1"),
      makeToken("t2", "B1"),
      makeToken("t3", "B2"),
    ]);
    const result = tokensByBatch(snap, "B1");
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("returns [] for an unknown batch id (not undefined)", () => {
    const snap = makeSnapshot([
      makeToken("t1", "B1"),
      makeToken("t2", "B2"),
    ]);
    const result = tokensByBatch(snap, "does-not-exist");
    expect(result).not.toBeUndefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it("returns [] for an empty snapshot", () => {
    const snap = makeSnapshot([]);
    const result = tokensByBatch(snap, "B1");
    expect(result).toEqual([]);
  });

  it("excludes tokens from other batches and unbatched tokens", () => {
    const snap = makeSnapshot([
      makeToken("t1", "B1"),
      makeToken("t2", "B2"),
      makeToken("t3", "B1"),
      makeToken("t4", undefined),
    ]);
    const result = tokensByBatch(snap, "B1");
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("preserves insertion order of snapshot.tokens Map", () => {
    const snap = makeSnapshot([
      makeToken("t3", "B1"),
      makeToken("t1", "B1"),
      makeToken("t2", "B1"),
    ]);
    const result = tokensByBatch(snap, "B1");
    expect(result.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });
});
