// test/engine/reducer.test.ts
//
// Pure fold tests for the engine reducer + `toEngineAction` translator.
//
// Reference: docs/tui/plans/P3-T2.md §8.3.

import { describe, it, expect } from "vitest";
import {
  engineReducer,
  initialEngineState,
  TAIL_EVENTS_CAP,
  toEngineAction,
} from "../../src/engine/reducer.js";
import type {
  EngineAction,
  EngineAdapterEvent,
  EngineState,
  MarkflowRunEvent,
} from "../../src/engine/types.js";
import type { EngineEvent, RunInfo } from "markflow";
import { stepStart } from "./helpers.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRunInfo(
  id: string,
  status: RunInfo["status"] = "running",
): RunInfo {
  return {
    id,
    workflowName: `wf-${id}`,
    sourceFile: `/fake/${id}.md`,
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    steps: [],
  };
}

// ---------------------------------------------------------------------------
// initialEngineState
// ---------------------------------------------------------------------------

describe("initialEngineState", () => {
  it("has empty runs map and no activeRun", () => {
    expect(initialEngineState.runs.size).toBe(0);
    expect(initialEngineState.activeRun).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RUN_ADDED
// ---------------------------------------------------------------------------

describe("RUN_ADDED", () => {
  it("inserts a run into the runs map", () => {
    const info = makeRunInfo("run-a");
    const next = engineReducer(initialEngineState, {
      type: "RUN_ADDED",
      runId: "run-a",
      info,
    });
    expect(next.runs.get("run-a")).toBe(info);
    expect(next.runs.size).toBe(1);
  });

  it("is idempotent (same id twice preserves last-write)", () => {
    const first = makeRunInfo("run-a", "running");
    const second = makeRunInfo("run-a", "complete");
    let s: EngineState = initialEngineState;
    s = engineReducer(s, { type: "RUN_ADDED", runId: "run-a", info: first });
    s = engineReducer(s, { type: "RUN_ADDED", runId: "run-a", info: second });
    expect(s.runs.size).toBe(1);
    expect(s.runs.get("run-a")).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// RUN_UPDATED
// ---------------------------------------------------------------------------

describe("RUN_UPDATED", () => {
  it("overwrites the snapshot", () => {
    const v1 = makeRunInfo("run-a", "running");
    const v2 = makeRunInfo("run-a", "complete");
    let s = engineReducer(initialEngineState, {
      type: "RUN_ADDED",
      runId: "run-a",
      info: v1,
    });
    s = engineReducer(s, { type: "RUN_UPDATED", runId: "run-a", info: v2 });
    expect(s.runs.get("run-a")).toBe(v2);
  });

  it("for an unknown id falls through to insert", () => {
    const v = makeRunInfo("run-new", "running");
    const s = engineReducer(initialEngineState, {
      type: "RUN_UPDATED",
      runId: "run-new",
      info: v,
    });
    expect(s.runs.get("run-new")).toBe(v);
  });
});

// ---------------------------------------------------------------------------
// RUN_REMOVED
// ---------------------------------------------------------------------------

describe("RUN_REMOVED", () => {
  it("drops the entry", () => {
    const info = makeRunInfo("run-a");
    let s = engineReducer(initialEngineState, {
      type: "RUN_ADDED",
      runId: "run-a",
      info,
    });
    s = engineReducer(s, { type: "RUN_REMOVED", runId: "run-a" });
    expect(s.runs.has("run-a")).toBe(false);
    expect(s.runs.size).toBe(0);
  });

  it("for unknown id is a no-op (returns same state reference)", () => {
    const s = engineReducer(initialEngineState, {
      type: "RUN_REMOVED",
      runId: "missing",
    });
    expect(s).toBe(initialEngineState);
  });

  it("clears activeRun when the active run is removed", () => {
    const info = makeRunInfo("run-a");
    let s = engineReducer(initialEngineState, {
      type: "RUN_ADDED",
      runId: "run-a",
      info,
    });
    s = engineReducer(s, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    expect(s.activeRun?.runId).toBe("run-a");
    s = engineReducer(s, { type: "RUN_REMOVED", runId: "run-a" });
    expect(s.activeRun).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RUN_TAIL_EVENT
// ---------------------------------------------------------------------------

describe("RUN_TAIL_EVENT", () => {
  it("appends to activeRun.events and updates lastSeq", () => {
    let s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(5),
    });
    expect(s.activeRun?.runId).toBe("run-a");
    expect(s.activeRun?.events.length).toBe(1);
    expect(s.activeRun?.lastSeq).toBe(5);

    s = engineReducer(s, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(6),
    });
    expect(s.activeRun?.events.length).toBe(2);
    expect(s.activeRun?.lastSeq).toBe(6);
  });

  it("ignores events for a non-active runId once activeRun is set", () => {
    let s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    // Event for a different runId should be dropped.
    const before = s;
    s = engineReducer(s, {
      type: "RUN_TAIL_EVENT",
      runId: "run-b",
      event: stepStart(2),
    });
    expect(s).toBe(before);
    expect(s.activeRun?.runId).toBe("run-a");
  });

  it(`ring-buffer caps at ${TAIL_EVENTS_CAP} entries`, () => {
    let s: EngineState = initialEngineState;
    // Push TAIL_EVENTS_CAP + 50 events.
    for (let i = 0; i < TAIL_EVENTS_CAP + 50; i++) {
      s = engineReducer(s, {
        type: "RUN_TAIL_EVENT",
        runId: "run-a",
        event: stepStart(i + 1),
      });
    }
    expect(s.activeRun?.events.length).toBe(TAIL_EVENTS_CAP);
    // The first event (seq=1) must have been dropped; last seq should be
    // TAIL_EVENTS_CAP + 50.
    const firstSeq = s.activeRun?.events[0]?.seq;
    const lastSeq = s.activeRun?.events[s.activeRun.events.length - 1]?.seq;
    expect(firstSeq).toBe(51);
    expect(lastSeq).toBe(TAIL_EVENTS_CAP + 50);
    expect(s.activeRun?.lastSeq).toBe(TAIL_EVENTS_CAP + 50);
  });

  it("seeds activeRun.info from the list if a RUN_ADDED preceded", () => {
    const info = makeRunInfo("run-a");
    let s = engineReducer(initialEngineState, {
      type: "RUN_ADDED",
      runId: "run-a",
      info,
    });
    s = engineReducer(s, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    expect(s.activeRun?.info).toBe(info);
  });
});

// ---------------------------------------------------------------------------
// RUN_TAIL_DETACHED
// ---------------------------------------------------------------------------

describe("RUN_TAIL_DETACHED", () => {
  it("flips activeRun.terminal=true on reason=terminal", () => {
    let s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    s = engineReducer(s, {
      type: "RUN_TAIL_DETACHED",
      runId: "run-a",
      reason: "terminal",
    });
    expect(s.activeRun?.terminal).toBe(true);
  });

  it("clears activeRun on reason=swapped", () => {
    let s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    s = engineReducer(s, {
      type: "RUN_TAIL_DETACHED",
      runId: "run-a",
      reason: "swapped",
    });
    expect(s.activeRun).toBeNull();
  });

  it("flips activeRun.terminal=true on reason=aborted", () => {
    let s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: stepStart(1),
    });
    s = engineReducer(s, {
      type: "RUN_TAIL_DETACHED",
      runId: "run-a",
      reason: "aborted",
    });
    expect(s.activeRun?.terminal).toBe(true);
  });

  it("is a no-op when there is no matching activeRun", () => {
    const s = engineReducer(initialEngineState, {
      type: "RUN_TAIL_DETACHED",
      runId: "run-a",
      reason: "terminal",
    });
    expect(s).toBe(initialEngineState);
  });
});

// ---------------------------------------------------------------------------
// toEngineAction
// ---------------------------------------------------------------------------

describe("toEngineAction", () => {
  it("maps list/added → RUN_ADDED", () => {
    const info = makeRunInfo("run-a");
    const listEvent: MarkflowRunEvent = {
      kind: "added",
      runId: "run-a",
      snapshot: info,
    };
    const action = toEngineAction({ kind: "list", event: listEvent });
    expect(action).toEqual({ type: "RUN_ADDED", runId: "run-a", info });
  });

  it("maps list/updated → RUN_UPDATED", () => {
    const info = makeRunInfo("run-a", "complete");
    const listEvent: MarkflowRunEvent = {
      kind: "updated",
      runId: "run-a",
      snapshot: info,
    };
    const action = toEngineAction({ kind: "list", event: listEvent });
    expect(action).toEqual({ type: "RUN_UPDATED", runId: "run-a", info });
  });

  it("maps list/removed → RUN_REMOVED", () => {
    const listEvent: MarkflowRunEvent = { kind: "removed", runId: "run-a" };
    const action = toEngineAction({ kind: "list", event: listEvent });
    expect(action).toEqual({ type: "RUN_REMOVED", runId: "run-a" });
  });

  it("maps run → RUN_TAIL_EVENT", () => {
    const evt: EngineEvent = stepStart(3);
    const action = toEngineAction({ kind: "run", runId: "run-a", event: evt });
    expect(action).toEqual({
      type: "RUN_TAIL_EVENT",
      runId: "run-a",
      event: evt,
    });
  });

  it("maps run:detached → RUN_TAIL_DETACHED (all reason variants)", () => {
    for (const reason of ["terminal", "swapped", "aborted"] as const) {
      const adapterEvent: EngineAdapterEvent = {
        kind: "run:detached",
        runId: "run-a",
        reason,
      };
      const action = toEngineAction(adapterEvent);
      expect(action).toEqual({
        type: "RUN_TAIL_DETACHED",
        runId: "run-a",
        reason,
      });
    }
  });

  it("round-trips every EngineAdapterEvent variant into a valid EngineAction", () => {
    // This test doubles as a runtime guard against the exhaustiveness
    // check in the reducer: any new EngineAdapterEvent variant added to
    // the union must have a case in toEngineAction or TypeScript will
    // fail to compile.
    const info = makeRunInfo("run-a");
    const cases: EngineAdapterEvent[] = [
      { kind: "list", event: { kind: "added", runId: "run-a", snapshot: info } },
      {
        kind: "list",
        event: { kind: "updated", runId: "run-a", snapshot: info },
      },
      { kind: "list", event: { kind: "removed", runId: "run-a" } },
      { kind: "run", runId: "run-a", event: stepStart(1) },
      { kind: "run:detached", runId: "run-a", reason: "terminal" },
    ];
    const actions: EngineAction[] = cases.map(toEngineAction);
    expect(actions.length).toBe(cases.length);
    for (const a of actions) expect(a.type).toMatch(/^RUN_/);
  });
});
