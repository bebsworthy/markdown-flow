// test/palette/exec.test.ts
import { describe, it, expect, vi } from "vitest";
import { executeCommand } from "../../src/palette/exec.js";
import { COMMANDS } from "../../src/palette/commands.js";
import type {
  CommandExecContext,
  CommandMatch,
  CommandResult,
} from "../../src/palette/types.js";
import type { AppState } from "../../src/state/types.js";
import { initialAppState } from "../../src/state/reducer.js";

function match(id: string): CommandMatch {
  const c = COMMANDS.find((c) => c.id === id)!;
  return { command: c, matchedIndices: [], score: 0 };
}

function mkCtx(overrides: Partial<CommandExecContext> = {}): CommandExecContext {
  const state: AppState = {
    ...initialAppState,
    mode: { kind: "viewing", runId: "r1", focus: "graph", runsDir: "/tmp/runs" },
  };
  return {
    state,
    dispatch: vi.fn(),
    runsDir: null,
    runActive: false,
    runResumable: false,
    pendingApprovalsCount: 0,
    runWorkflow: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    resumeRun: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    cancelRun: vi.fn(
      async (): Promise<CommandResult> => ({ kind: "ok" }),
    ),
    openApproval: vi.fn((): CommandResult => ({ kind: "ok" })),
    rotateTheme: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  };
}

describe("executeCommand", () => {
  it("run with missing arg → usage", async () => {
    const ctx = mkCtx();
    const r = await executeCommand(match("run"), "", ctx);
    expect(r.kind).toBe("usage");
  });

  it("run with arg delegates to ctx.runWorkflow", async () => {
    const ctx = mkCtx();
    await executeCommand(match("run"), "wf1", ctx);
    expect(ctx.runWorkflow).toHaveBeenCalledWith("wf1");
  });

  it("cancel while run not active → unavailable", async () => {
    const ctx = mkCtx({ runActive: false });
    const r = await executeCommand(match("cancel"), "", ctx);
    expect(r.kind).toBe("unavailable");
  });

  it("quit calls ctx.quit once and returns ok", async () => {
    const ctx = mkCtx();
    const r = await executeCommand(match("quit"), "", ctx);
    expect(r.kind).toBe("ok");
    expect(ctx.quit).toHaveBeenCalledTimes(1);
  });

  it("theme calls ctx.rotateTheme", async () => {
    const ctx = mkCtx();
    await executeCommand(match("theme"), "", ctx);
    expect(ctx.rotateTheme).toHaveBeenCalledTimes(1);
  });

  it("rerun forwards nodeId to ctx.resumeRun", async () => {
    const ctx = mkCtx({ runResumable: true });
    await executeCommand(match("rerun"), "deploy-us", ctx);
    expect(ctx.resumeRun).toHaveBeenCalledWith({
      runId: "r1",
      rerunNodes: ["deploy-us"],
      inputOverrides: {},
    });
  });

  it("executeCommand does NOT dispatch OVERLAY_CLOSE (caller's responsibility)", async () => {
    const ctx = mkCtx();
    await executeCommand(match("theme"), "", ctx);
    expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: "OVERLAY_CLOSE" });
  });
});
