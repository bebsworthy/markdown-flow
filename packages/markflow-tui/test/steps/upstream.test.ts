// test/steps/upstream.test.ts
//
// Unit tests for `src/steps/upstream.ts` — upstream-failed predicate and
// NOTE label for skipped step rows. Mockup §6 parity anchor: a skipped token
// whose parent fan-out token carries `edge: "fail"` renders with NOTE
// `"upstream failed"`.

import { describe, it, expect } from "vitest";
import type { StepResult, Token } from "markflow-cli";
import { isUpstreamFailed, upstreamNoteLabel } from "../../src/steps/upstream.js";

function tok(overrides: Partial<Token> = {}): Token {
  return {
    id: overrides.id ?? "t1",
    nodeId: overrides.nodeId ?? "node",
    generation: overrides.generation ?? 0,
    state: overrides.state ?? "skipped",
    edge: overrides.edge,
    result: overrides.result,
    batchId: overrides.batchId,
    itemIndex: overrides.itemIndex,
    parentTokenId: overrides.parentTokenId,
  };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "parent",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "fail",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T11:55:00Z",
    completed_at: overrides.completed_at ?? "2026-04-17T11:55:05Z",
    exit_code: overrides.exit_code ?? 1,
  };
}

describe("isUpstreamFailed", () => {
  it("non-skipped token → false", () => {
    const t = tok({ state: "running", parentTokenId: "p1" });
    const parent = tok({ id: "p1", state: "complete", result: result() });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(false);
  });

  it("skipped token without parent → false", () => {
    const t = tok({ state: "skipped", parentTokenId: undefined });
    expect(isUpstreamFailed(t, new Map())).toBe(false);
  });

  it("skipped token whose parent is missing from map → false", () => {
    const t = tok({ state: "skipped", parentTokenId: "p-missing" });
    expect(isUpstreamFailed(t, new Map())).toBe(false);
  });

  it("skipped child + parent complete with edge='fail' → true", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({
      id: "p1",
      state: "complete",
      result: result({ edge: "fail" }),
    });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(true);
  });

  it("skipped child + parent complete with edge='fail:max' → true", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({
      id: "p1",
      state: "complete",
      result: result({ edge: "fail:max" }),
    });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(true);
  });

  it("skipped child + parent complete with edge='success' → false", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({
      id: "p1",
      state: "complete",
      result: result({ edge: "success" }),
    });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(false);
  });

  it("skipped child + parent still running → false", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({ id: "p1", state: "running" });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(false);
  });

  it("skipped child + parent complete without result → false", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({ id: "p1", state: "complete", result: undefined });
    const map = new Map([["p1", parent]]);
    expect(isUpstreamFailed(t, map)).toBe(false);
  });
});

describe("upstreamNoteLabel", () => {
  it("returns 'upstream failed' (no colon) when predicate is true", () => {
    const t = tok({ state: "skipped", parentTokenId: "p1" });
    const parent = tok({
      id: "p1",
      state: "complete",
      result: result({ edge: "fail" }),
    });
    const map = new Map([["p1", parent]]);
    expect(upstreamNoteLabel(t, map)).toBe("upstream failed");
  });

  it("returns null when predicate is false", () => {
    const t = tok({ state: "running", parentTokenId: "p1" });
    const map = new Map<string, Token>();
    expect(upstreamNoteLabel(t, map)).toBeNull();
  });
});
