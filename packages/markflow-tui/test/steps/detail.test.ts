// test/steps/detail.test.ts
//
// Unit tests for `src/steps/detail.ts` — the pure projection that turns the
// engine slice into a `StepDetailModel`.

import { describe, it, expect } from "vitest";
import type {
  BatchState,
  EngineEvent,
  RunInfo,
  StepResult,
  Token,
} from "markflow-cli";
import {
  computeAttemptLabel,
  computeStepTypeLabel,
  computeTimeoutLabel,
  formatJsonOneLine,
  pickLastLog,
  pickRouteTarget,
  pickStderrTail,
  selectStepDetail,
} from "../../src/steps/detail.js";
import type { StepsSnapshot } from "../../src/steps/types.js";

const NOW = Date.parse("2026-04-17T12:04:25Z");

function tok(overrides: Partial<Token> = {}): Token {
  return {
    id: overrides.id ?? "t1",
    nodeId: overrides.nodeId ?? "deploy-eu",
    generation: overrides.generation ?? 0,
    state: overrides.state ?? "running",
    edge: overrides.edge,
    result: overrides.result,
    batchId: overrides.batchId,
    itemIndex: overrides.itemIndex,
    parentTokenId: overrides.parentTokenId,
  };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "deploy-eu",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T12:04:07Z",
    completed_at: overrides.completed_at ?? "2026-04-17T12:04:07Z",
    exit_code: overrides.exit_code ?? null,
  };
}

function snap(overrides: Partial<StepsSnapshot> = {}): StepsSnapshot {
  return {
    tokens: overrides.tokens ?? new Map(),
    retryBudgets: overrides.retryBudgets ?? new Map(),
    completedResults: overrides.completedResults ?? [],
    batches: overrides.batches ?? new Map(),
  };
}

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "r1",
    workflowName: overrides.workflowName ?? "multi-region",
    sourceFile: overrides.sourceFile ?? "./w.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T12:01:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

describe("selectStepDetail — dispatch", () => {
  it("returns empty when selection is null", () => {
    const m = selectStepDetail(snap(), null, [], null, NOW);
    expect(m.kind).toBe("empty");
  });

  it("returns not-found for an unknown tokenId", () => {
    const m = selectStepDetail(snap(), null, [], { rowId: "no-such" }, NOW);
    expect(m.kind).toBe("not-found");
  });

  it("returns aggregate for a known batch rowId", () => {
    const batch: BatchState = {
      nodeId: "deploy",
      expected: 3,
      completed: 2,
      succeeded: 1,
      failed: 1,
      onItemError: "continue",
      maxConcurrency: 0,
      spawned: 0,
      itemContexts: [],
      results: [],
      done: false,
    };
    const m = selectStepDetail(
      snap({ batches: new Map([["b1", batch]]) }),
      null,
      [],
      { rowId: "batch:b1" },
      NOW,
    );
    expect(m.kind).toBe("aggregate");
    if (m.kind === "aggregate") {
      expect(m.data.headline).toContain("batch [deploy]");
      expect(m.data.headline).toContain("forEach");
      expect(m.data.headline).toContain("2/3");
    }
  });

  it("returns not-found for a missing batch rowId", () => {
    const m = selectStepDetail(snap(), null, [], { rowId: "batch:missing" }, NOW);
    expect(m.kind).toBe("not-found");
  });
});

describe("selectStepDetail — running token (§4 parity)", () => {
  it("renders documented fields for a running deploy-eu token", () => {
    const t = tok({
      id: "t-eu",
      nodeId: "deploy-eu",
      state: "running",
      result: result({
        type: "script",
        started_at: "2026-04-17T12:04:07Z",
        local: { region: "eu-west-1", sha: "ab12cd" },
      }),
    });
    const events: EngineEvent[] = [
      {
        seq: 180,
        ts: "2026-04-17T12:04:07Z",
        type: "step:start",
        nodeId: "deploy-eu",
        tokenId: "t-eu",
      } as EngineEvent,
      {
        seq: 182,
        ts: "2026-04-17T12:04:10Z",
        type: "step:timeout",
        nodeId: "deploy-eu",
        tokenId: "t-eu",
        elapsedMs: 3000,
        limitMs: 90000,
      } as EngineEvent,
      {
        seq: 198,
        ts: "2026-04-17T12:04:24Z",
        type: "step:output",
        nodeId: "deploy-eu",
        stream: "stdout",
        chunk: "applying terraform plan (17/32 resources)\n",
      } as EngineEvent,
    ];
    const m = selectStepDetail(
      snap({
        tokens: new Map([[t.id, t]]),
        retryBudgets: new Map([["deploy-eu:fail", { count: 0, max: 2 }]]),
      }),
      null,
      events,
      { rowId: "t-eu" },
      NOW,
    );
    expect(m.kind).toBe("token");
    if (m.kind !== "token") return;
    const byKey = new Map(m.data.fields.map((f) => [f.key, f]));
    expect(byKey.get("type")!.value).toBe("script (bash)");
    expect(byKey.get("attempt")!.value).toBe("1/3");
    expect(byKey.get("timeout")!.value).toBe("90s");
    expect(byKey.get("exit")!.value).toBe("\u2014");
    expect(byKey.get("edge")!.value).toBe("\u2014");
    expect(byKey.get("started")!.value).toContain("12:04:07");
    expect(byKey.get("started")!.value).toContain("ago");
    expect(byKey.get("local")!.value).toContain("region");
    expect(byKey.get("last log")!.value).toContain("applying terraform plan");
    expect(m.data.statusLine).toBeNull();
  });
});

describe("selectStepDetail — terminal failed (§6 parity)", () => {
  it("surfaces statusLine, stderr tail, route-to and exit code", () => {
    const t = tok({
      id: "t-us",
      nodeId: "deploy-us",
      state: "complete",
      result: result({
        node: "deploy-us",
        type: "script",
        edge: "fail:max",
        started_at: "2026-04-17T12:03:06Z",
        completed_at: "2026-04-17T12:03:40Z",
        local: { region: "us-east-1", sha: "ab12cd" },
        exit_code: 1,
      }),
    });
    const events: EngineEvent[] = [
      {
        seq: 200,
        ts: "2026-04-17T12:03:06Z",
        type: "step:timeout",
        nodeId: "deploy-us",
        tokenId: "t-us",
        elapsedMs: 60000,
        limitMs: 60000,
      } as EngineEvent,
      {
        seq: 210,
        ts: "2026-04-17T12:03:38Z",
        type: "step:output",
        nodeId: "deploy-us",
        stream: "stderr",
        chunk: "ssh: connect timed out\nerror: region us-east unreachable\n",
      } as EngineEvent,
      {
        seq: 211,
        ts: "2026-04-17T12:03:39Z",
        type: "step:output",
        nodeId: "deploy-us",
        stream: "stderr",
        chunk: "retry budget 3/3 exhausted\n",
      } as EngineEvent,
      {
        seq: 214,
        ts: "2026-04-17T12:03:40Z",
        type: "step:complete",
        nodeId: "deploy-us",
        tokenId: "t-us",
        result: t.result!,
      } as EngineEvent,
      {
        seq: 215,
        ts: "2026-04-17T12:03:40Z",
        type: "route",
        from: "deploy-us",
        to: "rollback-us",
        edge: "fail:max",
      } as EngineEvent,
    ];
    const m = selectStepDetail(
      snap({
        tokens: new Map([[t.id, t]]),
        retryBudgets: new Map([["deploy-us:fail", { count: 2, max: 2 }]]),
      }),
      info(),
      events,
      { rowId: "t-us" },
      NOW,
    );
    expect(m.kind).toBe("token");
    if (m.kind !== "token") return;
    expect(m.data.statusLine).not.toBeNull();
    expect(m.data.statusLine).toContain("failed");
    expect(m.data.statusLine).toContain("exhausted");
    const byKey = new Map(m.data.fields.map((f) => [f.key, f]));
    expect(byKey.get("exit")!.value).toBe("1");
    expect(byKey.get("timeout")!.value).toBe("60s");
    expect(byKey.get("edge")!.value).toContain("fail:max");
    expect(byKey.get("edge")!.value).toContain("rollback-us");
    expect(m.data.stderrTail).toHaveLength(3);
    expect(m.data.stderrTail[0]!.text).toBe("ssh: connect timed out");
    expect(m.data.stderrTail[2]!.text).toBe("retry budget 3/3 exhausted");
    expect(m.data.stderrTailNote).toContain("last 3 lines");
  });
});

describe("selectStepDetail — completed ok", () => {
  it("no statusLine, empty stderr tail", () => {
    const t = tok({
      id: "t-ok",
      nodeId: "build",
      state: "complete",
      result: result({
        node: "build",
        type: "script",
        edge: "next",
        exit_code: 0,
        completed_at: "2026-04-17T12:01:30Z",
      }),
    });
    const m = selectStepDetail(
      snap({ tokens: new Map([[t.id, t]]) }),
      null,
      [],
      { rowId: "t-ok" },
      NOW,
    );
    expect(m.kind).toBe("token");
    if (m.kind !== "token") return;
    expect(m.data.statusLine).toBeNull();
    expect(m.data.stderrTail).toHaveLength(0);
  });
});

describe("selectStepDetail — waiting token", () => {
  it("returns an empty stderr tail and running role", () => {
    const t = tok({
      id: "t-wait",
      nodeId: "approve",
      state: "waiting",
      result: result({ node: "approve", type: "approval" }),
    });
    const m = selectStepDetail(
      snap({ tokens: new Map([[t.id, t]]) }),
      null,
      [],
      { rowId: "t-wait" },
      NOW,
    );
    expect(m.kind).toBe("token");
    if (m.kind !== "token") return;
    expect(m.data.role).toBe("waiting");
    expect(m.data.stderrTail).toHaveLength(0);
  });
});

describe("formatJsonOneLine", () => {
  it("renders scalars", () => {
    expect(formatJsonOneLine("abc", 80)).toBe(`"abc"`);
    expect(formatJsonOneLine(42, 80)).toBe("42");
    expect(formatJsonOneLine(null, 80)).toBe("\u2014");
    expect(formatJsonOneLine(undefined, 80)).toBe("\u2014");
  });

  it("renders a fitting object", () => {
    const s = formatJsonOneLine({ region: "eu-west-1", sha: "ab12cd" }, 80);
    expect(s).toBe(`{ region: "eu-west-1", sha: "ab12cd" }`);
  });

  it("drops trailing keys on overflow", () => {
    const s = formatJsonOneLine({ region: "eu-west-1", sha: "ab12cd", extra: "xxxxxxxxxxxxxx" }, 45);
    expect(s).toContain("region");
    expect(s).toContain("\u2026");
  });

  it("truncates a single-key overflow at char boundary", () => {
    const s = formatJsonOneLine({ verylong: "x".repeat(100) }, 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("\u2026")).toBe(true);
  });
});

describe("pickLastLog", () => {
  it("returns latest matching stdout/stderr event's last line", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "step:output", nodeId: "a", stream: "stdout",
        chunk: "hello\nworld",
      } as EngineEvent,
      {
        seq: 2, ts: "t", type: "step:output", nodeId: "a", stream: "stderr",
        chunk: "oops\n",
      } as EngineEvent,
    ];
    const last = pickLastLog(events, "a");
    expect(last).not.toBeNull();
    expect(last!.seq).toBe(2);
    expect(last!.stream).toBe("stderr");
    expect(last!.text).toBe("oops");
  });

  it("returns null when no match", () => {
    expect(pickLastLog([], "x")).toBeNull();
  });
});

describe("pickStderrTail", () => {
  it("preserves chronological order, max N", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "step:output", nodeId: "a", stream: "stderr",
        chunk: "one\ntwo\n",
      } as EngineEvent,
      {
        seq: 2, ts: "t", type: "step:output", nodeId: "a", stream: "stderr",
        chunk: "three\nfour\nfive\n",
      } as EngineEvent,
    ];
    const tail = pickStderrTail(events, "a", 3);
    expect(tail.map((l) => l.text)).toEqual(["three", "four", "five"]);
  });

  it("returns fewer when only a few exist", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "step:output", nodeId: "a", stream: "stderr",
        chunk: "only-one\n",
      } as EngineEvent,
    ];
    const tail = pickStderrTail(events, "a", 3);
    expect(tail.map((l) => l.text)).toEqual(["only-one"]);
  });

  it("returns [] when no stderr", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "step:output", nodeId: "a", stream: "stdout",
        chunk: "hello\n",
      } as EngineEvent,
    ];
    expect(pickStderrTail(events, "a", 3)).toEqual([]);
  });
});

describe("pickRouteTarget", () => {
  it("returns `to` when edge matches", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "route", from: "a", to: "b", edge: "fail:max",
      } as EngineEvent,
    ];
    expect(pickRouteTarget(events, "a", "fail:max")).toBe("b");
  });

  it("returns null when no event matches", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "route", from: "a", to: "b", edge: "next",
      } as EngineEvent,
    ];
    expect(pickRouteTarget(events, "a", "fail:max")).toBeNull();
  });
});

describe("computeAttemptLabel", () => {
  it("formats budget count/max", () => {
    const budgets = new Map([["n:fail", { count: 1, max: 2 }]]);
    expect(computeAttemptLabel(budgets, "n", undefined)).toBe("2/3");
  });

  it("marks exhausted when edge === fail:max", () => {
    const budgets = new Map([["n:fail", { count: 2, max: 2 }]]);
    expect(computeAttemptLabel(budgets, "n", "fail:max")).toContain("exhausted");
  });

  it("returns em-dash without a budget", () => {
    expect(computeAttemptLabel(new Map(), "n", undefined)).toBe("\u2014");
  });
});

describe("computeTimeoutLabel", () => {
  it("reads limitMs from a step:timeout event", () => {
    const events: EngineEvent[] = [
      {
        seq: 1, ts: "t", type: "step:timeout", nodeId: "n", tokenId: "t1",
        elapsedMs: 1000, limitMs: 60000,
      } as EngineEvent,
    ];
    expect(computeTimeoutLabel(events, "n", undefined)).toBe("60s");
  });

  it("returns em-dash when no timeout fired", () => {
    expect(computeTimeoutLabel([], "n", undefined)).toBe("\u2014");
  });
});

describe("computeStepTypeLabel", () => {
  it("maps all StepType variants", () => {
    expect(computeStepTypeLabel("script")).toBe("script (bash)");
    expect(computeStepTypeLabel("agent")).toBe("agent");
    expect(computeStepTypeLabel("approval")).toBe("approval");
    expect(computeStepTypeLabel(undefined)).toBe("\u2014");
  });
});
