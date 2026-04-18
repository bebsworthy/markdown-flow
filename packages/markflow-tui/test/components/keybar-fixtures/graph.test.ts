// test/components/keybar-fixtures/graph.test.ts
//
// Data-only assertions for the GRAPH_KEYBAR fixture. Specifically targets
// the `R Re-run` binding guard introduced in P7-T2: hidden-don't-grey
// unless `ctx.runResumable === true`.

import { describe, it, expect } from "vitest";
import { GRAPH_KEYBAR } from "../../../src/components/keybar-fixtures/graph.js";
import type { AppContext } from "../../../src/components/types.js";

function ctxWith(overrides: Partial<AppContext>): AppContext {
  return {
    mode: { kind: "viewing", runId: "r1", focus: "graph", runsDir: "/tmp/runs" },
    overlay: null,
    approvalsPending: false,
    isFollowing: false,
    isWrapped: false,
    toggleState: {},
    ...overrides,
  };
}

describe("GRAPH_KEYBAR — R Re-run visibility", () => {
  const rerunBinding = GRAPH_KEYBAR.find((b) => b.keys[0] === "R");

  it("defines a Re-run binding", () => {
    expect(rerunBinding).toBeDefined();
    expect(rerunBinding!.label).toBe("Re-run");
  });

  it("is hidden when ctx.runResumable is undefined", () => {
    const visible = rerunBinding!.when(ctxWith({}));
    expect(visible).toBe(false);
  });

  it("is hidden when ctx.runResumable is false", () => {
    const visible = rerunBinding!.when(ctxWith({ runResumable: false }));
    expect(visible).toBe(false);
  });

  it("is visible when ctx.runResumable is true", () => {
    const visible = rerunBinding!.when(ctxWith({ runResumable: true }));
    expect(visible).toBe(true);
  });
});
