// test/engine/resume.test.ts
//
// Tests for the impure `resumeRun` bridge (P7-T2). Mocks the
// `markflow` manager + `executeWorkflow` + `parseWorkflow` + `readEventLog`
// via the documented test seams so we do NOT touch the filesystem.

import { describe, it, expect, vi } from "vitest";
import {
  RunLockedError,
  type EngineEvent,
  type ResumeHandle,
  type RunInfo,
  type RunManager,
  type Token,
} from "markflow";
import { resumeRun } from "../../src/engine/resume.js";

function ts(seq: number): string {
  return new Date(seq * 1000).toISOString();
}

function runStart(seq: number): EngineEvent {
  return {
    type: "run:start",
    v: 1,
    workflowName: "wf",
    sourceFile: "/fake.md",
    inputs: {},
    configResolved: {} as never,
    seq,
    ts: ts(seq),
  };
}

/** Events that make `replay()` report a resumable status. We bootstrap with a
 * `workflow:error` event — the public `replay()` marks the run as "error". */
function erroredEvents(): EngineEvent[] {
  return [
    runStart(1),
    {
      type: "workflow:error",
      error: "boom",
      seq: 2,
      ts: ts(2),
    } as EngineEvent,
  ];
}

/** A fake snapshot exposing a tokens map. */
function fakeSnapshot(
  tokens: ReadonlyArray<readonly [string, string]>,
): ResumeHandle["snapshot"] {
  const m = new Map<string, Token>();
  for (const [id, nodeId] of tokens) {
    m.set(id, { id, nodeId, generation: 0, state: "complete" });
  }
  return { tokens: m } as unknown as ResumeHandle["snapshot"];
}

function makeHandle(args: {
  readonly tokens: ReadonlyArray<readonly [string, string]>;
  readonly append?: ReturnType<typeof vi.fn>;
  readonly release?: ReturnType<typeof vi.fn>;
}): ResumeHandle {
  const append = args.append ?? vi.fn().mockResolvedValue(undefined);
  const release = args.release ?? vi.fn().mockResolvedValue(undefined);
  return {
    runDir: { events: { append } } as unknown as ResumeHandle["runDir"],
    snapshot: fakeSnapshot(args.tokens),
    lastSeq: 2,
    tokenCounter: args.tokens.length,
    release,
  } as unknown as ResumeHandle;
}

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "run-1",
    workflowName: overrides.workflowName ?? "wf",
    sourceFile: overrides.sourceFile ?? "/fake.md",
    status: overrides.status ?? "error",
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00Z",
    steps: overrides.steps ?? [],
  };
}

function makeManager(overrides: Partial<RunManager> = {}): RunManager {
  return {
    createRun: vi.fn(),
    openExistingRun: vi.fn().mockResolvedValue(makeHandle({ tokens: [] })),
    listRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn().mockResolvedValue(info()),
    completeRun: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
    ...overrides,
  } as unknown as RunManager;
}

describe("resumeRun", () => {
  it("happy path: appends N × token:reset then 1 × global:update then executeWorkflow", async () => {
    const appendSpy = vi.fn().mockResolvedValue(undefined);
    const handle = makeHandle({
      tokens: [
        ["tok-build", "build"],
        ["tok-deploy", "deploy"],
      ],
      append: appendSpy,
    });
    const manager = makeManager({
      openExistingRun: vi.fn().mockResolvedValue(handle),
    });
    const execute = vi.fn().mockResolvedValue({});
    const parse = vi.fn().mockResolvedValue({ inputs: [], steps: [] });
    const readLog = vi.fn().mockResolvedValue(erroredEvents());

    const result = await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: ["build", "deploy"],
      inputOverrides: { env: "prod" },
      manager,
      execute: execute as unknown as Parameters<typeof resumeRun>[0]["execute"],
      parse: parse as unknown as Parameters<typeof resumeRun>[0]["parse"],
      readLog: readLog as unknown as Parameters<typeof resumeRun>[0]["readLog"],
    });

    expect(result).toEqual({ kind: "ok" });
    // append order: 2 resets, then 1 global:update
    expect(appendSpy).toHaveBeenCalledTimes(3);
    expect(appendSpy.mock.calls[0]![0]).toMatchObject({
      type: "token:reset",
      tokenId: "tok-build",
    });
    expect(appendSpy.mock.calls[1]![0]).toMatchObject({
      type: "token:reset",
      tokenId: "tok-deploy",
    });
    expect(appendSpy.mock.calls[2]![0]).toMatchObject({
      type: "global:update",
      keys: ["env"],
      patch: { env: "prod" },
    });
    expect(execute).toHaveBeenCalledOnce();
    const execArgs = execute.mock.calls[0]!;
    expect(execArgs[1]).toMatchObject({
      runsDir: "/tmp/runs",
      resumeFrom: handle,
    });
    expect(handle.release).toHaveBeenCalled();
  });

  it("RunLockedError surfaces as { kind: 'locked' }", async () => {
    const manager = makeManager({
      openExistingRun: vi
        .fn()
        .mockRejectedValue(new RunLockedError("run-1", "/tmp/runs/run-1/.lock")),
    });
    const result = await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: [],
      inputOverrides: {},
      manager,
      execute: vi.fn() as never,
      parse: vi.fn() as never,
      readLog: vi.fn().mockResolvedValue(erroredEvents()) as never,
    });
    expect(result).toMatchObject({ kind: "locked", runId: "run-1" });
  });

  it("snapshot status complete → { kind: 'notResumable' } without opening a handle", async () => {
    const openSpy = vi.fn();
    const manager = makeManager({ openExistingRun: openSpy });
    const readLog = vi.fn().mockResolvedValue([
      runStart(1),
      {
        type: "workflow:complete",
        results: [],
        seq: 2,
        ts: ts(2),
      } as EngineEvent,
    ]);
    const result = await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: [],
      inputOverrides: {},
      manager,
      execute: vi.fn() as never,
      parse: vi.fn() as never,
      readLog: readLog as never,
    });
    expect(result).toMatchObject({ kind: "notResumable" });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("rerun nodeId not in snapshot.tokens → { kind: 'unknownNode' } and handle released", async () => {
    const releaseSpy = vi.fn().mockResolvedValue(undefined);
    const handle = makeHandle({
      tokens: [["tok-a", "a"]],
      release: releaseSpy,
    });
    const manager = makeManager({
      openExistingRun: vi.fn().mockResolvedValue(handle),
    });
    const execute = vi.fn();
    const result = await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: ["missing"],
      inputOverrides: {},
      manager,
      execute: execute as never,
      parse: vi.fn().mockResolvedValue({ inputs: [], steps: [] }) as never,
      readLog: vi.fn().mockResolvedValue(erroredEvents()) as never,
    });
    expect(result).toMatchObject({ kind: "unknownNode", nodeId: "missing" });
    expect(execute).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("executeWorkflow rejects → { kind: 'error' } and handle released", async () => {
    const releaseSpy = vi.fn().mockResolvedValue(undefined);
    const handle = makeHandle({
      tokens: [["tok-a", "a"]],
      release: releaseSpy,
    });
    const manager = makeManager({
      openExistingRun: vi.fn().mockResolvedValue(handle),
    });
    const execute = vi.fn().mockRejectedValue(new Error("kaboom"));
    const result = await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: [],
      inputOverrides: {},
      manager,
      execute: execute as never,
      parse: vi.fn().mockResolvedValue({ inputs: [], steps: [] }) as never,
      readLog: vi.fn().mockResolvedValue(erroredEvents()) as never,
    });
    expect(result).toMatchObject({ kind: "error", message: "kaboom" });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("empty inputOverrides → no global:update appended", async () => {
    const appendSpy = vi.fn().mockResolvedValue(undefined);
    const handle = makeHandle({
      tokens: [["t", "a"]],
      append: appendSpy,
    });
    const manager = makeManager({
      openExistingRun: vi.fn().mockResolvedValue(handle),
    });
    await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: ["a"],
      inputOverrides: {},
      manager,
      execute: vi.fn().mockResolvedValue({}) as never,
      parse: vi.fn().mockResolvedValue({ inputs: [], steps: [] }) as never,
      readLog: vi.fn().mockResolvedValue(erroredEvents()) as never,
    });
    // only 1 append (token:reset); no global:update
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]![0].type).toBe("token:reset");
  });

  it("empty rerunNodes → no token:reset appended", async () => {
    const appendSpy = vi.fn().mockResolvedValue(undefined);
    const handle = makeHandle({
      tokens: [["t", "a"]],
      append: appendSpy,
    });
    const manager = makeManager({
      openExistingRun: vi.fn().mockResolvedValue(handle),
    });
    await resumeRun({
      runsDir: "/tmp/runs",
      runId: "run-1",
      rerunNodes: [],
      inputOverrides: { env: "prod" },
      manager,
      execute: vi.fn().mockResolvedValue({}) as never,
      parse: vi.fn().mockResolvedValue({ inputs: [], steps: [] }) as never,
      readLog: vi.fn().mockResolvedValue(erroredEvents()) as never,
    });
    // only 1 append — the global:update
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]![0].type).toBe("global:update");
  });
});
