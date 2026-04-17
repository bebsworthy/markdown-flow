// test/engine/decide.test.ts
//
// Tests for the impure `decideApproval` bridge (P7-T1). Mocks the
// `markflow` manager + `executeWorkflow` + `parseWorkflow` via the
// documented seam so we do NOT touch the filesystem.

import { describe, it, expect, vi } from "vitest";
import {
  RunLockedError,
  type EngineEvent,
  type ResumeHandle,
  type RunInfo,
  type RunManager,
} from "markflow";
import { decideApproval } from "../../src/engine/decide.js";

function waitingEvent(
  seq: number,
  nodeId: string,
  options: readonly string[] = ["approve", "reject"],
): EngineEvent {
  return {
    type: "step:waiting",
    v: 1,
    nodeId,
    tokenId: `t-${seq}`,
    prompt: "ok?",
    options: [...options],
    seq,
    ts: new Date().toISOString(),
  };
}

function makeHandle(): ResumeHandle {
  return {
    runDir: {} as ResumeHandle["runDir"],
    snapshot: {} as ResumeHandle["snapshot"],
    lastSeq: 1,
    tokenCounter: 0,
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResumeHandle;
}

function makeManager(overrides: Partial<RunManager> = {}): RunManager {
  const info: RunInfo = {
    id: "run-1",
    workflowName: "wf",
    sourceFile: "/fake.md",
    status: "suspended",
    startedAt: "2026-01-01T00:00:00Z",
    steps: [],
  };
  return {
    createRun: vi.fn(),
    openExistingRun: vi.fn().mockResolvedValue(makeHandle()),
    listRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn().mockResolvedValue(info),
    completeRun: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
    ...overrides,
  } as unknown as RunManager;
}

describe("decideApproval", () => {
  it("happy path → ok", async () => {
    const manager = makeManager();
    const execute = vi.fn().mockResolvedValue({});
    const parse = vi.fn().mockResolvedValue({ steps: [] });
    const readLog = vi.fn().mockResolvedValue([waitingEvent(1, "review")]);

    const result = await decideApproval({
      runsDir: "/tmp/runs",
      runId: "run-1",
      nodeId: "review",
      choice: "approve",
      manager,
      execute: execute as unknown as Parameters<typeof decideApproval>[0]["execute"],
      parse: parse as unknown as Parameters<typeof decideApproval>[0]["parse"],
      readLog: readLog as unknown as Parameters<typeof decideApproval>[0]["readLog"],
    });

    expect(result).toEqual({ kind: "ok" });
    expect(execute).toHaveBeenCalledOnce();
    const callArgs = execute.mock.calls[0]!;
    expect(callArgs[1].approvalDecision).toMatchObject({
      nodeId: "review",
      choice: "approve",
    });
  });

  it("RunLockedError → locked", async () => {
    const manager = makeManager({
      openExistingRun: vi.fn().mockRejectedValue(
        new RunLockedError("run-1", "/tmp/runs/run-1/.lock"),
      ),
    });
    const result = await decideApproval({
      runsDir: "/tmp/runs",
      runId: "run-1",
      nodeId: "review",
      choice: "approve",
      manager,
      execute: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["execute"],
      parse: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["parse"],
      readLog: vi
        .fn()
        .mockResolvedValue([
          waitingEvent(1, "review"),
        ]) as unknown as Parameters<typeof decideApproval>[0]["readLog"],
    });
    expect(result).toMatchObject({ kind: "locked", runId: "run-1" });
  });

  it("no matching waiting → notWaiting", async () => {
    const manager = makeManager();
    const result = await decideApproval({
      runsDir: "/tmp/runs",
      runId: "run-1",
      nodeId: "review",
      choice: "approve",
      manager,
      execute: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["execute"],
      parse: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["parse"],
      readLog: vi
        .fn()
        .mockResolvedValue([]) as unknown as Parameters<typeof decideApproval>[0]["readLog"],
    });
    expect(result).toEqual({ kind: "notWaiting" });
  });

  it("choice not in options → invalidChoice", async () => {
    const manager = makeManager();
    const result = await decideApproval({
      runsDir: "/tmp/runs",
      runId: "run-1",
      nodeId: "review",
      choice: "other",
      manager,
      execute: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["execute"],
      parse: vi.fn() as unknown as Parameters<typeof decideApproval>[0]["parse"],
      readLog: vi
        .fn()
        .mockResolvedValue([
          waitingEvent(1, "review", ["approve", "reject"]),
        ]) as unknown as Parameters<typeof decideApproval>[0]["readLog"],
    });
    expect(result).toEqual({ kind: "invalidChoice" });
  });

  it("executeWorkflow rejects → error", async () => {
    const manager = makeManager();
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await decideApproval({
      runsDir: "/tmp/runs",
      runId: "run-1",
      nodeId: "review",
      choice: "approve",
      manager,
      execute: execute as unknown as Parameters<typeof decideApproval>[0]["execute"],
      parse: vi
        .fn()
        .mockResolvedValue({
          steps: [],
        }) as unknown as Parameters<typeof decideApproval>[0]["parse"],
      readLog: vi
        .fn()
        .mockResolvedValue([
          waitingEvent(1, "review"),
        ]) as unknown as Parameters<typeof decideApproval>[0]["readLog"],
    });
    expect(result).toMatchObject({ kind: "error", message: "boom" });
  });
});
