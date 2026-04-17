// test/app/resume-wizard.test.tsx
//
// App-level integration tests for the resume wizard overlay (P7-T2).
// Drives the full <App> tree via ink-testing-library with a seeded engine
// slice whose active run is in a terminal `error` state.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { EngineEvent, RunInfo } from "markflow";
import { App } from "../../src/app.js";
import type { EngineState, LiveRunSnapshot } from "../../src/engine/types.js";
import type { ResumeSubmitResult } from "../../src/resume/types.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ENTER = "\r";
const KEY_RUNS = "2";
const NOW = Date.parse("2026-04-17T12:00:00Z");

function info(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "wf",
    sourceFile: overrides.sourceFile ?? "./wf.md",
    status: overrides.status ?? "error",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function ts(seq: number): string {
  return new Date(seq * 1000).toISOString();
}

function failEvent(seq: number, nodeId = "deploy"): EngineEvent {
  return {
    type: "step:complete",
    nodeId,
    tokenId: `t-${seq}`,
    result: {
      node: nodeId,
      type: "script",
      edge: "fail",
      summary: "",
      started_at: "2026-04-17T11:55:10Z",
      completed_at: "2026-04-17T11:55:30Z",
      exit_code: 2,
    },
    seq,
    ts: ts(seq),
  } as EngineEvent;
}

/** Events minimally sufficient to reconstruct a token so the wizard's
 *  `deriveRerunNodes` produces at least one row. */
function failingRunEvents(seq: number, nodeId = "deploy"): EngineEvent[] {
  const tokenId = `t-${seq}`;
  return [
    {
      type: "token:created",
      tokenId,
      nodeId,
      generation: 0,
      seq,
      ts: ts(seq),
    } as EngineEvent,
    failEvent(seq + 1, nodeId),
  ];
}

function buildEngineState(
  runId: string,
  events: readonly EngineEvent[],
  status: RunInfo["status"] = "error",
): EngineState {
  const runInfo = info({ id: runId, status });
  const activeRun: LiveRunSnapshot = {
    runId,
    info: runInfo,
    events: [...events],
    lastSeq: events[events.length - 1]?.seq ?? 0,
    terminal: true,
  };
  return {
    runs: new Map([[runId, runInfo]]),
    activeRun,
  };
}

async function flush(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

function rowsFor(runId: string, status: RunInfo["status"] = "error"): ReadonlyArray<RunsTableRow> {
  return [toRunsTableRow(info({ id: runId, status }), NOW)];
}

interface RenderArgs {
  readonly initialMode?: "browsing" | "viewing";
  readonly engineState: EngineState;
  readonly status?: RunInfo["status"];
  readonly resumeRun?: (args: {
    readonly runsDir: string;
    readonly runId: string;
    readonly rerunNodes: readonly string[];
    readonly inputOverrides: Readonly<Record<string, string>>;
  }) => Promise<ResumeSubmitResult>;
}

async function renderApp(
  args: RenderArgs,
): Promise<ReturnType<typeof render>> {
  const runId = args.engineState.activeRun?.runId ?? "r1";
  const out = render(
    <App
      onQuit={() => {}}
      registryConfig={{ listPath: null, persist: false }}
      initialRunRows={rowsFor(runId, args.status ?? "error")}
      engineState={args.engineState}
      runsDir={"/tmp/fake-runs"}
      resumeRun={args.resumeRun}
    />,
  );
  await flush();
  if (args.initialMode === "viewing") {
    out.stdin.write(KEY_RUNS);
    await flush();
    out.stdin.write(ENTER);
    await flush();
  }
  return out;
}

describe("App — resume wizard overlay (P7-T2)", () => {
  it("R on an errored active run opens the wizard with failing node preselected", async () => {
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", failingRunEvents(1, "deploy"), "error"),
    });
    await flush();
    out.stdin.write("R");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("RESUME");
    expect(frame).toContain("deploy");
    // `[x]` on the preselected failing row
    expect(frame).toContain("[x] deploy");
  });

  it("R on a complete run is a no-op (hidden binding)", async () => {
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", [], "complete"),
      status: "complete",
    });
    await flush();
    out.stdin.write("R");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("RESUME");
  });

  it("Enter calls resumeRun with the seeded overlay state; overlay closes on ok", async () => {
    const resume = vi.fn(async () => ({ kind: "ok" as const }));
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", failingRunEvents(1, "deploy"), "error"),
      resumeRun: resume,
    });
    await flush();
    out.stdin.write("R");
    await flush();
    out.stdin.write(ENTER);
    await flush(6);
    expect(resume).toHaveBeenCalledOnce();
    const callArgs = (resume.mock.calls[0] as unknown as readonly [{
      readonly runsDir: string;
      readonly runId: string;
      readonly rerunNodes: readonly string[];
      readonly inputOverrides: Readonly<Record<string, string>>;
    }])[0];
    expect(callArgs.runId).toBe("r1");
    expect(callArgs.rerunNodes).toContain("deploy");
    expect(callArgs.runsDir).toBe("/tmp/fake-runs");
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("RESUME");
  });

  it("locked result keeps the overlay open with a retry message", async () => {
    const resume = vi.fn(
      async () =>
        ({ kind: "locked", runId: "r1", lockPath: "/x" }) satisfies ResumeSubmitResult,
    );
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", failingRunEvents(1, "deploy"), "error"),
      resumeRun: resume,
    });
    await flush();
    out.stdin.write("R");
    await flush();
    out.stdin.write(ENTER);
    await flush(6);
    expect(resume).toHaveBeenCalledTimes(1);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Another resume is in progress");
  });

  it("Esc closes the wizard without calling resumeRun", async () => {
    const resume = vi.fn(async () => ({ kind: "ok" as const }));
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", failingRunEvents(1, "deploy"), "error"),
      resumeRun: resume,
    });
    await flush();
    out.stdin.write("R");
    await flush();
    out.stdin.write("\x1b");
    await flush();
    expect(resume).not.toHaveBeenCalled();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).not.toContain("RESUME");
  });

  it("double-Enter while submitting fires resumeRun exactly once", async () => {
    let resolveResume: (v: ResumeSubmitResult) => void = () => {};
    const resume = vi.fn(
      () =>
        new Promise<ResumeSubmitResult>((r) => {
          resolveResume = r;
        }),
    );
    const out = await renderApp({
      initialMode: "viewing",
      engineState: buildEngineState("r1", failingRunEvents(1, "deploy"), "error"),
      resumeRun: resume,
    });
    await flush();
    out.stdin.write("R");
    await flush();
    out.stdin.write(ENTER);
    await flush();
    out.stdin.write(ENTER);
    await flush();
    expect(resume).toHaveBeenCalledTimes(1);
    resolveResume({ kind: "ok" });
    await flush();
  });
});
