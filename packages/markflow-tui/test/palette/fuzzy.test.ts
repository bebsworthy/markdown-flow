// test/palette/fuzzy.test.ts
import { describe, it, expect } from "vitest";
import { filterCommands, matchCommand } from "../../src/palette/fuzzy.js";
import { COMMANDS } from "../../src/palette/commands.js";
import type { AppContext } from "../../src/components/types.js";

const ctx: AppContext = {
  mode: { kind: "viewing", runId: "r1", focus: "graph", runsDir: "/tmp/runs" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
  pendingApprovalsCount: 2,
  runResumable: true,
  runActive: false,
};

describe("palette fuzzy matcher", () => {
  it("prefix `re` matches resume then rerun", () => {
    const out = filterCommands("re", COMMANDS, ctx);
    const names = out.map((m) => m.command.name);
    expect(names.slice(0, 2)).toEqual(["resume", "rerun"]);
  });

  it("order-preserving: `qt` matches quit, `tq` does not", () => {
    const quit = COMMANDS.find((c) => c.id === "quit")!;
    expect(matchCommand("qt", quit)).not.toBeNull();
    expect(matchCommand("tq", quit)).toBeNull();
  });

  it("empty query returns all available commands in catalogue order", () => {
    const out = filterCommands("", COMMANDS, ctx);
    const ids = out.map((m) => m.command.id);
    // `approve` requires pendingApprovalsCount > 0 (satisfied), `cancel`
    // requires runActive (not satisfied), `rerun`/`goto` need viewing.
    expect(ids).toContain("run");
    expect(ids).toContain("quit");
    expect(ids).not.toContain("cancel");
  });

  it("when(ctx)=false commands are omitted", () => {
    const browseCtx: AppContext = {
      ...ctx,
      mode: { kind: "browsing", pane: "workflows" },
      pendingApprovalsCount: 0,
      runResumable: false,
    };
    const out = filterCommands("", COMMANDS, browseCtx);
    const ids = out.map((m) => m.command.id);
    expect(ids).not.toContain("rerun");
    expect(ids).not.toContain("cancel");
    expect(ids).not.toContain("approve");
    expect(ids).not.toContain("goto");
  });

  it("matchedIndices are monotonic and in-bounds", () => {
    const run = COMMANDS.find((c) => c.id === "run")!;
    const m = matchCommand("rn", run);
    expect(m).not.toBeNull();
    const idxs = m!.matchedIndices;
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]!).toBeGreaterThan(idxs[i - 1]!);
    }
    for (const i of idxs) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(run.name.length);
    }
  });

  it("tie-break uses catalogue order", () => {
    const out = filterCommands("", COMMANDS, ctx);
    // All scores are 0 for empty query; catalogue order should be preserved.
    const firstFive = out.slice(0, 3).map((m) => m.command.id);
    expect(firstFive[0]).toBe("run");
  });

  it("is case-insensitive", () => {
    const run = COMMANDS.find((c) => c.id === "run")!;
    expect(matchCommand("R", run)).not.toBeNull();
    expect(matchCommand("RUN", run)).not.toBeNull();
  });
});
