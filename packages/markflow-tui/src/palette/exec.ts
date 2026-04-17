// src/palette/exec.ts
//
// Pure command dispatcher (P7-T3). Calls IO closures on `ctx`; contains
// no direct IO itself.

import type { CommandExecContext, CommandMatch, CommandResult } from "./types.js";

export async function executeCommand(
  match: CommandMatch,
  arg: string,
  ctx: CommandExecContext,
): Promise<CommandResult> {
  const { command } = match;

  // Race: re-check availability.
  // (The palette already filters with ctx.when, but state may have moved.)
  if (command.argRequired && arg === "") {
    return { kind: "usage", message: `usage: ${command.usage}` };
  }

  switch (command.id) {
    case "run": {
      if (arg === "") {
        return { kind: "usage", message: `usage: ${command.usage}` };
      }
      return ctx.runWorkflow(arg);
    }
    case "resume": {
      if (arg !== "") {
        return ctx.resumeRun({
          runId: arg,
          rerunNodes: [],
          inputOverrides: {},
        });
      }
      ctx.dispatch({ type: "MODE_SHOW_RUNS" });
      return { kind: "ok" };
    }
    case "rerun": {
      if (ctx.state.mode.kind !== "viewing") {
        return {
          kind: "unavailable",
          message: "rerun requires an open run",
        };
      }
      if (!ctx.runResumable) {
        return {
          kind: "unavailable",
          message: "run is not resumable",
        };
      }
      return ctx.resumeRun({
        runId: ctx.state.mode.runId,
        rerunNodes: [arg],
        inputOverrides: {},
      });
    }
    case "cancel": {
      if (ctx.state.mode.kind !== "viewing") {
        return {
          kind: "unavailable",
          message: "no active run to cancel",
        };
      }
      if (!ctx.runActive) {
        return {
          kind: "unavailable",
          message: "run not active",
        };
      }
      return ctx.cancelRun(ctx.state.mode.runId);
    }
    case "approve": {
      if (ctx.state.mode.kind !== "viewing") {
        return {
          kind: "unavailable",
          message: "approve requires an open run",
        };
      }
      if (ctx.pendingApprovalsCount <= 0) {
        return {
          kind: "unavailable",
          message: "no pending approvals",
        };
      }
      return ctx.openApproval(ctx.state.mode.runId);
    }
    case "pending": {
      ctx.dispatch({ type: "MODE_SHOW_RUNS" });
      return { kind: "ok" };
    }
    case "goto": {
      if (ctx.state.mode.kind !== "viewing") {
        return {
          kind: "unavailable",
          message: "goto requires an open run",
        };
      }
      ctx.dispatch({ type: "FOCUS_VIEWING_PANE", focus: "events" });
      return { kind: "ok" };
    }
    case "theme": {
      ctx.rotateTheme();
      return { kind: "ok" };
    }
    case "quit": {
      ctx.quit();
      return { kind: "ok" };
    }
  }
}
