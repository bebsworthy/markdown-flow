// test/resume/derive.test.ts
//
// Unit tests for pure derivations in `src/resume/derive.ts` (P7-T2 §4.1).

import { describe, it, expect } from "vitest";
import type {
  EngineEvent,
  RunInfo,
  StepResult,
  Token,
  WorkflowDefinition,
} from "markflow-cli";

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "wf",
    sourceFile: overrides.sourceFile ?? "./wf.md",
    status: overrides.status ?? "error",
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function ts(seq: number): string {
  return new Date(seq * 1000).toISOString();
}

function result(nodeId: string, exit: number | null): StepResult {
  return {
    node: nodeId,
    type: "script",
    edge: exit === 0 ? "success" : "fail",
    summary: "",
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:01Z",
    exit_code: exit,
  } as StepResult;
}

function ev(seq: number, p: Omit<EngineEvent, "seq" | "ts">): EngineEvent {
  return { ...p, seq, ts: ts(seq) } as EngineEvent;
}

describe("deriveResumableRun", () => {
  it("returns null when status is complete", async () => {
    const { deriveResumableRun } = await import("../../src/resume/derive.js");
    expect(deriveResumableRun(info({ status: "complete" }), [])).toBeNull();
    expect(deriveResumableRun(info({ status: "running" }), [])).toBeNull();
  });

  it("labels retry:exhausted events", async () => {
    const { deriveResumableRun } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, { type: "retry:exhausted", nodeId: "deploy-us", label: "fail" } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const out = deriveResumableRun(info({ status: "error" }), events);
    expect(out).not.toBeNull();
    expect(out!.lastEventLabel).toContain("retry:exhausted");
    expect(out!.lastEventLabel).toContain("deploy-us");
    expect(out!.lastSeq).toBe(1);
  });

  it("labels workflow:error events", async () => {
    const { deriveResumableRun } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(3, { type: "workflow:error", error: "kaboom" } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const out = deriveResumableRun(info({ status: "error" }), events);
    expect(out!.lastEventLabel).toContain("workflow:error");
    expect(out!.lastEventLabel).toContain("kaboom");
  });

  it("labels step:waiting for suspended runs", async () => {
    const { deriveResumableRun } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(5, {
        type: "step:waiting",
        v: 1,
        nodeId: "gate",
        tokenId: "t1",
        prompt: "?",
        options: ["a", "b"],
      } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const out = deriveResumableRun(info({ status: "suspended" }), events);
    expect(out!.lastEventLabel).toContain("step:waiting");
    expect(out!.lastEventLabel).toContain("gate");
  });

  it("populates runId/workflowName/startedAt verbatim", async () => {
    const { deriveResumableRun } = await import("../../src/resume/derive.js");
    const i = info({
      id: "run-42",
      workflowName: "deploy",
      startedAt: "2026-04-17T11:55:00Z",
      status: "error",
    });
    const out = deriveResumableRun(i, []);
    expect(out!.runId).toBe("run-42");
    expect(out!.workflowName).toBe("deploy");
    expect(out!.startedAt).toBe("2026-04-17T11:55:00Z");
    expect(out!.status).toBe("error");
  });
});

describe("deriveRerunNodes", () => {
  function tokens(pairs: ReadonlyArray<readonly [string, string, Token["state"]]>): Map<string, Token> {
    const m = new Map<string, Token>();
    for (const [id, nodeId, state] of pairs) {
      m.set(id, { id, nodeId, generation: 0, state });
    }
    return m;
  }

  it("preselects exactly one failing token (latest by event order)", async () => {
    const { deriveRerunNodes } = await import("../../src/resume/derive.js");
    const toks = tokens([
      ["t1", "build", "complete"],
      ["t2", "deploy", "complete"],
    ]);
    const events: EngineEvent[] = [
      ev(1, { type: "step:complete", nodeId: "build", tokenId: "t1", result: result("build", 1) } as Omit<EngineEvent, "seq" | "ts">),
      ev(2, { type: "step:complete", nodeId: "deploy", tokenId: "t2", result: result("deploy", 2) } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveRerunNodes(info({ status: "error" }), events, toks);
    const pre = rows.filter((r) => r.preselected);
    expect(pre).toHaveLength(1);
    expect(pre[0]!.nodeId).toBe("deploy");
  });

  it("uses engine tokens when provided; reconstructs from events when omitted", async () => {
    const { deriveRerunNodes } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, { type: "token:created", tokenId: "t1", nodeId: "a", generation: 0 } as Omit<EngineEvent, "seq" | "ts">),
      ev(2, { type: "token:state", tokenId: "t1", from: "pending", to: "running" } as Omit<EngineEvent, "seq" | "ts">),
      ev(3, { type: "step:complete", nodeId: "a", tokenId: "t1", result: result("a", 0) } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveRerunNodes(info({ status: "error" }), events);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nodeId).toBe("a");
  });

  it("orders error → waiting → complete → skipped", async () => {
    const { deriveRerunNodes } = await import("../../src/resume/derive.js");
    const toks = tokens([
      ["t-complete", "n-complete", "complete"],
      ["t-wait", "n-wait", "waiting"],
      ["t-skip", "n-skip", "skipped"],
      ["t-err", "n-err", "complete"],
    ]);
    const events: EngineEvent[] = [
      ev(1, { type: "step:complete", nodeId: "n-err", tokenId: "t-err", result: result("n-err", 1) } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveRerunNodes(info({ status: "error" }), events, toks);
    const states = rows.map((r) => r.state);
    // error first
    expect(states[0]).toBe("error");
    // skipped last
    expect(states[states.length - 1]).toBe("skipped");
    // waiting comes before complete
    const waitingIdx = states.indexOf("waiting");
    const completeIdx = states.indexOf("complete");
    expect(waitingIdx).toBeLessThan(completeIdx);
  });
});

describe("deriveInputRows", () => {
  const workflow = {
    title: "wf",
    sourceFile: "./wf.md",
    inputs: [
      { name: "env", required: true, default: "staging" },
      { name: "region", required: false },
    ],
    steps: [],
  } as unknown as WorkflowDefinition;

  it("surfaces undeclared keys from run:start.inputs", async () => {
    const { deriveInputRows } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, {
        type: "run:start",
        v: 1,
        runId: "r1",
        workflowName: "wf",
        sourceFile: "./wf.md",
        inputs: { env: "prod", undeclared: "yes" },
        configResolved: {} as never,
      } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveInputRows(workflow, events);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("env");
    expect(keys).toContain("region");
    expect(keys).toContain("undeclared");
  });

  it("seeds draft === original and edited === false", async () => {
    const { deriveInputRows } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, {
        type: "run:start",
        v: 1,
        runId: "r1",
        workflowName: "wf",
        sourceFile: "./wf.md",
        inputs: { env: "prod" },
        configResolved: {} as never,
      } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveInputRows(workflow, events);
    for (const row of rows) {
      expect(row.draft).toBe(row.original);
      expect(row.edited).toBe(false);
    }
    const envRow = rows.find((r) => r.key === "env")!;
    expect(envRow.original).toBe("prod");
    const regionRow = rows.find((r) => r.key === "region")!;
    expect(regionRow.original).toBe(""); // no default, no run:start value
  });

  it("falls back to declaration.default when run:start value is missing", async () => {
    const { deriveInputRows } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, {
        type: "run:start",
        v: 1,
        runId: "r1",
        workflowName: "wf",
        sourceFile: "./wf.md",
        inputs: {},
        configResolved: {} as never,
      } as Omit<EngineEvent, "seq" | "ts">),
    ];
    const rows = deriveInputRows(workflow, events);
    const envRow = rows.find((r) => r.key === "env")!;
    expect(envRow.original).toBe("staging");
  });
});

describe("findFailingNode", () => {
  it("returns the nodeId of the most recent non-zero step:complete", async () => {
    const { findFailingNode } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, { type: "step:complete", nodeId: "a", tokenId: "t1", result: result("a", 0) } as Omit<EngineEvent, "seq" | "ts">),
      ev(2, { type: "step:complete", nodeId: "b", tokenId: "t2", result: result("b", 2) } as Omit<EngineEvent, "seq" | "ts">),
    ];
    expect(findFailingNode(info({ status: "error" }), events)).toBe("b");
  });

  it("falls back to step:waiting when run is suspended", async () => {
    const { findFailingNode } = await import("../../src/resume/derive.js");
    const events: EngineEvent[] = [
      ev(1, {
        type: "step:waiting",
        v: 1,
        nodeId: "gate",
        tokenId: "t1",
        prompt: "?",
        options: ["a"],
      } as Omit<EngineEvent, "seq" | "ts">),
    ];
    expect(findFailingNode(info({ status: "suspended" }), events)).toBe("gate");
  });

  it("returns null for happy terminal runs", async () => {
    const { findFailingNode } = await import("../../src/resume/derive.js");
    expect(findFailingNode(info({ status: "complete" }), [])).toBeNull();
  });
});

describe("isRunResumable", () => {
  it("matches error/suspended, rejects everything else", async () => {
    const { isRunResumable } = await import("../../src/resume/derive.js");
    expect(isRunResumable(info({ status: "error" }))).toBe(true);
    expect(isRunResumable(info({ status: "suspended" }))).toBe(true);
    expect(isRunResumable(info({ status: "complete" }))).toBe(false);
    expect(isRunResumable(info({ status: "running" }))).toBe(false);
    expect(isRunResumable(null)).toBe(false);
    expect(isRunResumable(undefined)).toBe(false);
  });
});
