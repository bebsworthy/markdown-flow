// test/app/approval-overlay.test.tsx
//
// App-level integration tests for the approval overlay (P7-T1). Drives the
// full <App> tree via ink-testing-library with a seeded engine slice whose
// active-run tail contains a `step:waiting` event.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { App } from "../../src/app.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";
import type { ApprovalSubmitResult } from "../../src/approval/types.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ENTER = "\r";
const KEY_RUNS = "2";
const NOW = Date.parse("2026-04-17T12:00:00Z");

function info(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "wf",
    sourceFile: overrides.sourceFile ?? "./wf.md",
    status: overrides.status ?? "suspended",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function waiting(seq: number, nodeId = "review"): EngineEvent {
  return {
    type: "step:waiting",
    v: 1,
    nodeId,
    tokenId: `t-${seq}`,
    prompt: "Approve?",
    options: ["approve", "reject"],
    seq,
    ts: "2026-04-17T11:55:30Z",
  };
}

function buildEngineState(
  runId: string,
  events: readonly EngineEvent[],
  status: RunInfo["status"] = "suspended",
): EngineState {
  const runInfo = info({ id: runId, status });
  const activeRun: LiveRunSnapshot = {
    runId,
    info: runInfo,
    events: [...events],
    lastSeq: events[events.length - 1]?.seq ?? 0,
    terminal: false,
  };
  return {
    runs: new Map([[runId, runInfo]]),
    activeRun,
  };
}
function rowsFor(runId: string): ReadonlyArray<RunsTableRow> {
  return [toRunsTableRow(info({ id: runId }), NOW)];
}

interface RenderArgs {
  readonly initialMode?: "browsing" | "viewing";
  readonly engineState: EngineState;
  readonly decideApproval?: (args: {
    readonly runsDir: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly choice: string;
    readonly decidedBy?: string;
  }) => Promise<ApprovalSubmitResult>;
}

async function renderApp(
  args: RenderArgs,
): Promise<ReturnType<typeof render>> {
  const runId =
    args.engineState.activeRun?.runId ?? "r1";
  const out = render(
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={rowsFor(runId)}
      engineState={args.engineState}
      runsDir={"/tmp/fake-runs"}
      decideApproval={args.decideApproval}
    />,
  );
  await flush();
  if (args.initialMode === "viewing") {
    // Navigate: Runs tab → Enter on the first row → viewing.graph.
    out.stdin.write(KEY_RUNS);
    await flush();
    out.stdin.write(ENTER);
    await flush();
  }
  return out;
}

describe("App — approval overlay (P7-T1)", () => {
  it("auto-opens when in viewing.* with a matching gate", async () => {
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", [waiting(1)]),
    });
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("APPROVAL \u00b7 review");
    expect(frame).toContain("Approve?");
  });

  it("does NOT auto-open in browsing.runs but surfaces pending via ctx", async () => {
    const out = await renderApp({
      engineState: buildEngineState("r1", [waiting(1)]),
    });
    // stays on browsing.workflows by default — no modal
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("APPROVAL \u00b7");
  });

  it("s closes the modal without calling decideApproval", async () => {
    const decide = vi.fn(async () => ({ kind: "ok" as const }));
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", [waiting(1)]),
      decideApproval: decide,
    });
    await flush();
    out.stdin.write("s");
    await flush();
    expect(decide).not.toHaveBeenCalled();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("APPROVAL \u00b7 review");
  });

  it("Enter invokes decideApproval; locked result keeps the modal open", async () => {
    const decide = vi.fn(
      async () =>
        ({ kind: "locked", runId: "r1", lockPath: "/lock" }) satisfies
        ApprovalSubmitResult,
    );
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", [waiting(1)]),
      decideApproval: decide,
    });
    await flush();
    out.stdin.write(ENTER);
    await flush(6);
    expect(decide).toHaveBeenCalledTimes(1);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Another approve is in progress");
  });

  it("double-Enter while submitting produces exactly one decide call", async () => {
    let resolveDecide: (v: ApprovalSubmitResult) => void = () => {};
    const decide = vi.fn(
      () =>
        new Promise<ApprovalSubmitResult>((r) => {
          resolveDecide = r;
        }),
    );
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", [waiting(1)]),
      decideApproval: decide,
    });
    await flush();
    out.stdin.write(ENTER);
    await flush();
    out.stdin.write(ENTER);
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    resolveDecide({ kind: "ok" });
    await flush();
  });
});
