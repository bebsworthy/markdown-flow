// test/help/derive.test.ts
import { describe, it, expect } from "vitest";
import { deriveHelpModel } from "../../src/help/derive.js";
import { GRAPH_KEYBAR } from "../../src/components/keybar-fixtures/graph.js";
import type { AppContext, Binding } from "../../src/components/types.js";

const viewingCtx = (
  overrides: Partial<AppContext> = {},
): AppContext => ({
  mode: { kind: "viewing", runId: "r1", focus: "graph", runsDir: "/tmp/runs" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
  pendingApprovalsCount: 0,
  runResumable: false,
  ...overrides,
});

describe("deriveHelpModel", () => {
  it("omits bindings whose when(ctx)=false entirely", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 0, runResumable: false }),
      search: "",
    });
    const all = m.sections.flatMap((s) => s.rows.map((r) => r.keys[0]));
    expect(all).not.toContain("a");
    expect(all).not.toContain("R");
  });

  it("preserves fixture order within a category", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 2, runResumable: true }),
      search: "",
    });
    const view = m.sections.find((s) => s.category === "VIEW");
    expect(view).toBeDefined();
    const viewKeys = view!.rows.map((r) => r.keys[0]);
    expect(viewKeys).toEqual(["1", "2", "3", "4"]);
  });

  it("bindings without .category go to GLOBAL", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 2, runResumable: true }),
      search: "",
    });
    expect(m.sections.some((s) => s.category === "GLOBAL")).toBe(true);
  });

  it("search matches label or keys (case-insensitive)", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 2 }),
      search: "app",
    });
    const all = m.sections.flatMap((s) => s.rows);
    expect(all.length).toBe(1);
    expect(all[0]!.keys[0]).toBe("a");
  });

  it("toggleLabel resolves for approve binding", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 1 }),
      search: "",
    });
    const approve = m.sections
      .flatMap((s) => s.rows)
      .find((r) => r.keys[0] === "a");
    expect(approve?.label).toBe("Approve (1)");
  });

  it("attaches annotation to approve row when pendingApprovalsCount > 0", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 3 }),
      search: "",
    });
    const approve = m.sections
      .flatMap((s) => s.rows)
      .find((r) => r.keys[0] === "a");
    expect(approve?.annotation).toBe("(3 available)");
  });

  it("totalRows sums section rows", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ pendingApprovalsCount: 2, runResumable: true }),
      search: "",
    });
    const sum = m.sections.reduce((a, s) => a + s.rows.length, 0);
    expect(m.totalRows).toBe(sum);
  });

  it("omits `R Re-run` when runResumable=false", () => {
    const m = deriveHelpModel({
      bindings: GRAPH_KEYBAR,
      ctx: viewingCtx({ runResumable: false, pendingApprovalsCount: 2 }),
      search: "",
    });
    const keys = m.sections.flatMap((s) => s.rows.map((r) => r.keys[0]));
    expect(keys).not.toContain("R");
  });

  it("empty bindings yields empty model", () => {
    const m = deriveHelpModel({
      bindings: [] as readonly Binding[],
      ctx: viewingCtx(),
      search: "",
    });
    expect(m.totalRows).toBe(0);
    expect(m.sections).toEqual([]);
  });
});
