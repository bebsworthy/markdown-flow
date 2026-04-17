// test/engine/run.test.ts
//
// Unit tests for the impure `runWorkflow` bridge (P9-T1). Mocks via the
// documented test seams so we do NOT touch the filesystem.

import { describe, it, expect, vi } from "vitest";
import {
  RunLockedError,
  type EngineEvent,
  type RunInfo,
  type WorkflowDefinition,
} from "markflow";
import { runWorkflow } from "../../src/engine/run.js";

function wf(inputs: WorkflowDefinition["inputs"] = []): WorkflowDefinition {
  return {
    name: "wf",
    description: "",
    inputs,
    graph: { nodes: new Map(), edges: [] },
    steps: new Map(),
    sourceFile: "/fake.md",
  };
}

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "run-1",
    workflowName: overrides.workflowName ?? "wf",
    sourceFile: overrides.sourceFile ?? "/fake.md",
    status: overrides.status ?? "complete",
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00Z",
    steps: overrides.steps ?? [],
  };
}

describe("runWorkflow", () => {
  it("happy path: returns ok+runId, fires onRunStart exactly once via event", async () => {
    const onRunStart = vi.fn();
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi.fn(async (_w: unknown, opts: { onEvent?: (e: EngineEvent) => void }) => {
      // Simulate the engine emitting a synthetic run:start carrying runId.
      opts.onEvent?.({
        type: "run:start",
        v: 1,
        runId: "rX",
        workflowName: "wf",
        sourceFile: "/fake.md",
        inputs: {},
        configResolved: {} as never,
        seq: 1,
        ts: "2026-01-01T00:00:00Z",
      } as unknown as EngineEvent);
      return info({ id: "rX" });
    });
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
      onRunStart,
    });
    expect(result).toEqual({ kind: "ok", runId: "rX" });
    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(onRunStart).toHaveBeenCalledWith("rX");
  });

  it("parseError when parse throws", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("bad md"));
    const execute = vi.fn();
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
    });
    expect(result).toEqual({ kind: "parseError", message: "bad md" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("RunLockedError → { kind: 'locked' }", async () => {
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi
      .fn()
      .mockRejectedValue(new RunLockedError("run-1", "/tmp/runs/run-1/.lock"));
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
    });
    expect(result).toMatchObject({ kind: "locked", runId: "run-1" });
  });

  it("ConfigError 'Missing required workflow inputs' → invalidInputs", async () => {
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Missing required workflow inputs: env, version. Set them in the environment, …",
        ),
      );
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
    });
    expect(result).toEqual({
      kind: "invalidInputs",
      missing: ["env", "version"],
    });
  });

  it("any other exception → { kind: 'error' }", async () => {
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi.fn().mockRejectedValue(new Error("kaboom"));
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
    });
    expect(result).toEqual({ kind: "error", message: "kaboom" });
  });

  it("passes runsDir / workspaceDir / inputs to execute with no resumeFrom", async () => {
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi.fn().mockResolvedValue(info({ id: "r1" }));
    await runWorkflow({
      runsDir: "/rd",
      workspaceDir: "/wd",
      sourceFile: "/fake.md",
      inputs: { env: "prod" },
      parse: parse as never,
      execute: execute as never,
    });
    const call = execute.mock.calls[0]!;
    expect(call[1]).toMatchObject({
      runsDir: "/rd",
      workspaceDir: "/wd",
      inputs: { env: "prod" },
    });
    expect((call[1] as { resumeFrom?: unknown }).resumeFrom).toBeUndefined();
    expect((call[1] as { approvalDecision?: unknown }).approvalDecision).toBeUndefined();
  });

  it("falls back to RunInfo.id when no event carries runId", async () => {
    const onRunStart = vi.fn();
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi.fn().mockResolvedValue(info({ id: "r-from-info" }));
    const result = await runWorkflow({
      runsDir: "/tmp/runs",
      workspaceDir: "/tmp/ws",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
      onRunStart,
    });
    expect(result).toEqual({ kind: "ok", runId: "r-from-info" });
    expect(onRunStart).toHaveBeenCalledWith("r-from-info");
  });

  it("passes empty inputs verbatim when none supplied", async () => {
    const parse = vi.fn().mockResolvedValue(wf());
    const execute = vi.fn().mockResolvedValue(info({ id: "r" }));
    await runWorkflow({
      runsDir: "/rd",
      workspaceDir: "/wd",
      sourceFile: "/fake.md",
      inputs: {},
      parse: parse as never,
      execute: execute as never,
    });
    expect(execute.mock.calls[0]![1].inputs).toEqual({});
  });
});
