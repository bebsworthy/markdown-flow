// test/state/reducer.test.ts
import { describe, it, expect } from "vitest";
import { initialAppState, reducer } from "../../src/state/reducer.js";
import type { Action, AppState, Overlay } from "../../src/state/types.js";

// --- Small fixture helpers ---------------------------------------------------

const viewingState = (runId = "run-1", focus: "graph" | "detail" | "log" = "graph"): AppState => ({
  ...initialAppState,
  mode: { kind: "viewing", runId, focus },
});

const withOverlay = (state: AppState, overlay: Overlay): AppState => ({ ...state, overlay });

describe("initialAppState", () => {
  it("starts in browsing/workflows with no overlay and no filter", () => {
    expect(initialAppState.mode).toEqual({ kind: "browsing", pane: "workflows" });
    expect(initialAppState.overlay).toBeNull();
    expect(initialAppState.filter).toBe("");
    expect(initialAppState.selectedWorkflowId).toBeNull();
    expect(initialAppState.selectedRunId).toBeNull();
  });
});

describe("MODE_SHOW_WORKFLOWS", () => {
  it("switches from runs to workflows", () => {
    const s = reducer({ ...initialAppState, mode: { kind: "browsing", pane: "runs" } }, {
      type: "MODE_SHOW_WORKFLOWS",
    });
    expect(s.mode).toEqual({ kind: "browsing", pane: "workflows" });
  });
  it("clears filter on mode switch", () => {
    const s = reducer({ ...initialAppState, filter: "foo" }, { type: "MODE_SHOW_WORKFLOWS" });
    expect(s.filter).toBe("");
  });
});

describe("MODE_SHOW_RUNS", () => {
  it("switches to runs pane", () => {
    const s = reducer(initialAppState, { type: "MODE_SHOW_RUNS" });
    expect(s.mode).toEqual({ kind: "browsing", pane: "runs" });
  });
});

describe("MODE_OPEN_RUN", () => {
  it("enters viewing with default graph focus", () => {
    const s = reducer(initialAppState, { type: "MODE_OPEN_RUN", runId: "r1" });
    expect(s.mode).toEqual({ kind: "viewing", runId: "r1", focus: "graph" });
    expect(s.selectedRunId).toBe("r1");
  });
  it("honours explicit focus argument", () => {
    const s = reducer(initialAppState, { type: "MODE_OPEN_RUN", runId: "r1", focus: "log" });
    expect(s.mode).toEqual({ kind: "viewing", runId: "r1", focus: "log" });
  });
});

describe("MODE_CLOSE_RUN", () => {
  it("returns to browsing.runs", () => {
    const s = reducer(viewingState(), { type: "MODE_CLOSE_RUN" });
    expect(s.mode).toEqual({ kind: "browsing", pane: "runs" });
  });
});

describe("FOCUS_BROWSING_PANE", () => {
  it("swaps pane within browsing", () => {
    const s = reducer(initialAppState, { type: "FOCUS_BROWSING_PANE", pane: "runs" });
    expect(s.mode).toEqual({ kind: "browsing", pane: "runs" });
  });
  it("is a no-op if already on target pane (referentially stable)", () => {
    const s = reducer(initialAppState, { type: "FOCUS_BROWSING_PANE", pane: "workflows" });
    expect(s).toBe(initialAppState);
  });
  it("is ignored in viewing mode", () => {
    const base = viewingState();
    const s = reducer(base, { type: "FOCUS_BROWSING_PANE", pane: "runs" });
    expect(s).toBe(base);
  });
});

describe("FOCUS_VIEWING_PANE", () => {
  it("moves focus graph → detail → log", () => {
    let s = viewingState();
    s = reducer(s, { type: "FOCUS_VIEWING_PANE", focus: "detail" });
    expect(s.mode).toEqual({ kind: "viewing", runId: "run-1", focus: "detail" });
    s = reducer(s, { type: "FOCUS_VIEWING_PANE", focus: "log" });
    expect(s.mode).toEqual({ kind: "viewing", runId: "run-1", focus: "log" });
  });
  it("is ignored in browsing mode", () => {
    const s = reducer(initialAppState, { type: "FOCUS_VIEWING_PANE", focus: "log" });
    expect(s).toBe(initialAppState);
  });
});

describe("SELECT_WORKFLOW / SELECT_RUN", () => {
  it("stores workflow id", () => {
    const s = reducer(initialAppState, { type: "SELECT_WORKFLOW", workflowId: "wf-1" });
    expect(s.selectedWorkflowId).toBe("wf-1");
  });
  it("clears workflow id with null", () => {
    const base: AppState = { ...initialAppState, selectedWorkflowId: "wf-1" };
    const s = reducer(base, { type: "SELECT_WORKFLOW", workflowId: null });
    expect(s.selectedWorkflowId).toBeNull();
  });
  it("stores run id", () => {
    const s = reducer(initialAppState, { type: "SELECT_RUN", runId: "r1" });
    expect(s.selectedRunId).toBe("r1");
  });
});

describe("FILTER_SET / FILTER_CLEAR", () => {
  it("sets filter value", () => {
    const s = reducer(initialAppState, { type: "FILTER_SET", value: "deploy" });
    expect(s.filter).toBe("deploy");
  });
  it("clears filter", () => {
    const s = reducer({ ...initialAppState, filter: "x" }, { type: "FILTER_CLEAR" });
    expect(s.filter).toBe("");
  });
  it("FILTER_CLEAR is identity when already empty", () => {
    const s = reducer(initialAppState, { type: "FILTER_CLEAR" });
    expect(s).toBe(initialAppState);
  });
});

describe("OVERLAY_OPEN / OVERLAY_CLOSE", () => {
  const overlays: Overlay[] = [
    { kind: "approval", runId: "r1", nodeId: "n1", state: "idle" },
    { kind: "resumeWizard", runId: "r1", rerun: new Set(["n1"]), inputs: { KEY: "v" } },
    { kind: "confirmCancel", runId: "r1" },
    { kind: "commandPalette", query: "" },
    { kind: "help" },
  ];
  for (const ov of overlays) {
    it(`opens ${ov.kind}`, () => {
      const s = reducer(initialAppState, { type: "OVERLAY_OPEN", overlay: ov });
      expect(s.overlay).toEqual(ov);
    });
  }
  it("closes active overlay", () => {
    const base = withOverlay(initialAppState, { kind: "help" });
    const s = reducer(base, { type: "OVERLAY_CLOSE" });
    expect(s.overlay).toBeNull();
  });
  it("OVERLAY_CLOSE is identity when no overlay", () => {
    const s = reducer(initialAppState, { type: "OVERLAY_CLOSE" });
    expect(s).toBe(initialAppState);
  });
});

describe("APPROVAL_SUBMIT", () => {
  it("transitions idle → submitting", () => {
    const base = withOverlay(initialAppState, {
      kind: "approval", runId: "r1", nodeId: "n1", state: "idle",
    });
    const s = reducer(base, { type: "APPROVAL_SUBMIT" });
    expect(s.overlay).toMatchObject({ kind: "approval", state: "submitting" });
  });
  it("is a no-op when not submitting an approval", () => {
    const base = withOverlay(initialAppState, { kind: "help" });
    const s = reducer(base, { type: "APPROVAL_SUBMIT" });
    expect(s).toBe(base);
  });
  it("is idempotent once already submitting", () => {
    const base = withOverlay(initialAppState, {
      kind: "approval", runId: "r1", nodeId: "n1", state: "submitting",
    });
    const s = reducer(base, { type: "APPROVAL_SUBMIT" });
    expect(s).toBe(base);
  });
});

describe("COMMAND_PALETTE_QUERY", () => {
  it("updates query text on the active palette overlay", () => {
    const base = withOverlay(initialAppState, { kind: "commandPalette", query: "" });
    const s = reducer(base, { type: "COMMAND_PALETTE_QUERY", query: "run " });
    expect(s.overlay).toEqual({ kind: "commandPalette", query: "run " });
  });
  it("is ignored when palette not open", () => {
    const s = reducer(initialAppState, { type: "COMMAND_PALETTE_QUERY", query: "x" });
    expect(s).toBe(initialAppState);
  });
});

describe("RESUME_WIZARD_TOGGLE_RERUN", () => {
  it("adds a node id to the rerun set", () => {
    const base = withOverlay(initialAppState, {
      kind: "resumeWizard", runId: "r1", rerun: new Set(), inputs: {},
    });
    const s = reducer(base, { type: "RESUME_WIZARD_TOGGLE_RERUN", nodeId: "build" });
    expect(s.overlay).toMatchObject({ kind: "resumeWizard" });
    const ov = s.overlay as { rerun: ReadonlySet<string> };
    expect([...ov.rerun]).toEqual(["build"]);
  });
  it("removes the node id on the second toggle", () => {
    const base = withOverlay(initialAppState, {
      kind: "resumeWizard", runId: "r1", rerun: new Set(["build"]), inputs: {},
    });
    const s = reducer(base, { type: "RESUME_WIZARD_TOGGLE_RERUN", nodeId: "build" });
    const ov = s.overlay as { rerun: ReadonlySet<string> };
    expect(ov.rerun.size).toBe(0);
  });
});

describe("RESUME_WIZARD_SET_INPUT", () => {
  it("sets an input value", () => {
    const base = withOverlay(initialAppState, {
      kind: "resumeWizard", runId: "r1", rerun: new Set(), inputs: {},
    });
    const s = reducer(base, { type: "RESUME_WIZARD_SET_INPUT", key: "KEY", value: "v" });
    const ov = s.overlay as { inputs: Record<string, string> };
    expect(ov.inputs).toEqual({ KEY: "v" });
  });
});

// -------- Purity: calling reducer twice with the same args yields deep-equal
// output and never mutates the input. -------------------------------------
describe("reducer purity", () => {
  it("never mutates the input state", () => {
    const before = JSON.parse(JSON.stringify({
      ...initialAppState,
      // JSON.stringify can't express Set — skip resumeWizard here.
    })) as AppState;
    const a: Action = { type: "FILTER_SET", value: "x" };
    reducer(initialAppState, a);
    expect(initialAppState).toEqual(before);
  });
  it("is deterministic", () => {
    const a: Action = { type: "MODE_OPEN_RUN", runId: "r1" };
    const s1 = reducer(initialAppState, a);
    const s2 = reducer(initialAppState, a);
    expect(s1).toEqual(s2);
  });
});
