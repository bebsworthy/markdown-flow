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

describe("reducer — P4-T3 addWorkflow overlay", () => {
  it("OVERLAY_OPEN with addWorkflow sets overlay.kind='addWorkflow', tab='fuzzy'", () => {
    const s = reducer(initialAppState, {
      type: "OVERLAY_OPEN",
      overlay: { kind: "addWorkflow", tab: "fuzzy" },
    });
    expect(s.overlay).toEqual({ kind: "addWorkflow", tab: "fuzzy" });
  });

  it("OVERLAY_OPEN with addWorkflow + tab='url' preserves tab", () => {
    const s = reducer(initialAppState, {
      type: "OVERLAY_OPEN",
      overlay: { kind: "addWorkflow", tab: "url" },
    });
    expect(s.overlay).toEqual({ kind: "addWorkflow", tab: "url" });
  });

  it("ADD_MODAL_SET_TAB flips tab from 'fuzzy' to 'url'", () => {
    const base = withOverlay(initialAppState, {
      kind: "addWorkflow",
      tab: "fuzzy",
    });
    const s = reducer(base, { type: "ADD_MODAL_SET_TAB", tab: "url" });
    expect(s.overlay).toEqual({ kind: "addWorkflow", tab: "url" });
  });

  it("ADD_MODAL_SET_TAB with same tab returns identical state reference", () => {
    const base = withOverlay(initialAppState, {
      kind: "addWorkflow",
      tab: "fuzzy",
    });
    const s = reducer(base, { type: "ADD_MODAL_SET_TAB", tab: "fuzzy" });
    expect(s).toBe(base);
  });

  it("ADD_MODAL_SET_TAB when overlay is null is a no-op", () => {
    const s = reducer(initialAppState, {
      type: "ADD_MODAL_SET_TAB",
      tab: "url",
    });
    expect(s).toBe(initialAppState);
  });

  it("ADD_MODAL_SET_TAB when overlay.kind is not addWorkflow is a no-op", () => {
    const base = withOverlay(initialAppState, { kind: "help" });
    const s = reducer(base, { type: "ADD_MODAL_SET_TAB", tab: "url" });
    expect(s).toBe(base);
  });

  it("OVERLAY_CLOSE clears addWorkflow overlay", () => {
    const base = withOverlay(initialAppState, {
      kind: "addWorkflow",
      tab: "fuzzy",
    });
    const s = reducer(base, { type: "OVERLAY_CLOSE" });
    expect(s.overlay).toBeNull();
  });
});

describe("RUNS_SORT_CYCLE", () => {
  it("initial runsSort is { key: 'attention', direction: 'desc' }", () => {
    expect(initialAppState.runsSort).toEqual({
      key: "attention",
      direction: "desc",
    });
  });

  it("advances key attention → started (first step)", () => {
    const s = reducer(initialAppState, { type: "RUNS_SORT_CYCLE" });
    expect(s.runsSort).toEqual({ key: "started", direction: "desc" });
  });

  it("cycles through all 7 keys and wraps back to attention", () => {
    const order = [
      "attention",
      "started",
      "ended",
      "elapsed",
      "status",
      "workflow",
      "id",
    ] as const;
    let s = initialAppState;
    for (let i = 0; i < order.length; i++) {
      expect(s.runsSort.key).toBe(order[i]);
      s = reducer(s, { type: "RUNS_SORT_CYCLE" });
    }
    // After the 7th cycle we should be back at "attention".
    expect(s.runsSort.key).toBe("attention");
  });

  it("always keeps direction='desc'", () => {
    let s = initialAppState;
    for (let i = 0; i < 7; i++) {
      s = reducer(s, { type: "RUNS_SORT_CYCLE" });
      expect(s.runsSort.direction).toBe("desc");
    }
  });

  it("does not touch unrelated state slices", () => {
    const base: AppState = {
      ...initialAppState,
      filter: "foo",
      selectedRunId: "r1",
      selectedWorkflowId: "wf-1",
    };
    const s = reducer(base, { type: "RUNS_SORT_CYCLE" });
    expect(s.filter).toBe("foo");
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedWorkflowId).toBe("wf-1");
    expect(s.mode).toEqual(base.mode);
    expect(s.overlay).toBeNull();
  });
});

// -------- P5-T2: runs filter / archive actions --------------------------

describe("initialAppState — P5-T2 slices", () => {
  it("runsFilter starts closed with empty draft + applied", () => {
    expect(initialAppState.runsFilter.open).toBe(false);
    expect(initialAppState.runsFilter.draft).toBe("");
    expect(initialAppState.runsFilter.applied.raw).toBe("");
    expect(initialAppState.runsFilter.applied.terms).toEqual([]);
  });

  it("runsArchive defaults to RUNS_ARCHIVE_DEFAULTS shape", () => {
    expect(initialAppState.runsArchive.shown).toBe(false);
    expect(initialAppState.runsArchive.completeMaxAgeMs).toBe(86_400_000);
    expect(initialAppState.runsArchive.errorMaxAgeMs).toBe(604_800_000);
  });
});

describe("RUNS_FILTER_OPEN", () => {
  it("opens the bar and seeds draft from applied.raw", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: {
        open: false,
        draft: "",
        applied: {
          raw: "status:running",
          terms: [{ kind: "status", value: "running" }],
        },
      },
    };
    const s = reducer(base, { type: "RUNS_FILTER_OPEN" });
    expect(s.runsFilter.open).toBe(true);
    expect(s.runsFilter.draft).toBe("status:running");
  });

  it("is idempotent when already open", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: { open: true, draft: "abc", applied: { raw: "", terms: [] } },
    };
    const s = reducer(base, { type: "RUNS_FILTER_OPEN" });
    expect(s).toBe(base);
  });
});

describe("RUNS_FILTER_INPUT", () => {
  it("updates the draft without reparsing", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: { open: true, draft: "", applied: { raw: "", terms: [] } },
    };
    const s = reducer(base, { type: "RUNS_FILTER_INPUT", value: "status:" });
    expect(s.runsFilter.draft).toBe("status:");
    // applied untouched — parser not run on INPUT.
    expect(s.runsFilter.applied.terms).toEqual([]);
  });

  it("is a no-op when the bar is closed", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: { open: false, draft: "", applied: { raw: "", terms: [] } },
    };
    const s = reducer(base, { type: "RUNS_FILTER_INPUT", value: "abc" });
    expect(s).toBe(base);
  });
});

describe("RUNS_FILTER_APPLY", () => {
  it("parses the draft, stores it in applied, closes the bar", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: {
        open: true,
        draft: "status:running",
        applied: { raw: "", terms: [] },
      },
    };
    const s = reducer(base, { type: "RUNS_FILTER_APPLY" });
    expect(s.runsFilter.open).toBe(false);
    expect(s.runsFilter.applied.raw).toBe("status:running");
    expect(s.runsFilter.applied.terms).toEqual([
      { kind: "status", value: "running" },
    ]);
  });

  it("is a no-op when the bar is closed", () => {
    const base = initialAppState;
    const s = reducer(base, { type: "RUNS_FILTER_APPLY" });
    expect(s).toBe(base);
  });
});

describe("RUNS_FILTER_CLEAR", () => {
  it("resets draft + applied, closes the bar", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: {
        open: true,
        draft: "abc",
        applied: {
          raw: "status:running",
          terms: [{ kind: "status", value: "running" }],
        },
      },
    };
    const s = reducer(base, { type: "RUNS_FILTER_CLEAR" });
    expect(s.runsFilter.open).toBe(false);
    expect(s.runsFilter.draft).toBe("");
    expect(s.runsFilter.applied.terms).toEqual([]);
  });

  it("is idempotent from the empty state", () => {
    const base = initialAppState;
    const s = reducer(base, { type: "RUNS_FILTER_CLEAR" });
    expect(s).toBe(base);
  });
});

describe("RUNS_FILTER_CLOSE", () => {
  it("closes without clearing applied", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: {
        open: true,
        draft: "status:running",
        applied: {
          raw: "status:running",
          terms: [{ kind: "status", value: "running" }],
        },
      },
    };
    const s = reducer(base, { type: "RUNS_FILTER_CLOSE" });
    expect(s.runsFilter.open).toBe(false);
    expect(s.runsFilter.applied.terms).toHaveLength(1);
  });
});

describe("RUNS_ARCHIVE_TOGGLE", () => {
  it("flips shown and preserves threshold fields", () => {
    const s = reducer(initialAppState, { type: "RUNS_ARCHIVE_TOGGLE" });
    expect(s.runsArchive.shown).toBe(true);
    expect(s.runsArchive.completeMaxAgeMs).toBe(
      initialAppState.runsArchive.completeMaxAgeMs,
    );
  });

  it("two toggles return to identity (flipped shown twice)", () => {
    const a = reducer(initialAppState, { type: "RUNS_ARCHIVE_TOGGLE" });
    const b = reducer(a, { type: "RUNS_ARCHIVE_TOGGLE" });
    expect(b.runsArchive.shown).toBe(initialAppState.runsArchive.shown);
  });
});

describe("P5-T2 slice preservation across mode switches", () => {
  it("runsFilter/runsArchive survive MODE_SHOW_WORKFLOWS", () => {
    const base: AppState = {
      ...initialAppState,
      runsFilter: {
        open: false,
        draft: "",
        applied: {
          raw: "status:running",
          terms: [{ kind: "status", value: "running" }],
        },
      },
      runsArchive: { ...initialAppState.runsArchive, shown: true },
    };
    const s = reducer(base, { type: "MODE_SHOW_WORKFLOWS" });
    expect(s.runsFilter.applied.raw).toBe("status:running");
    expect(s.runsArchive.shown).toBe(true);
  });

  it("runsFilter/runsArchive survive MODE_OPEN_RUN", () => {
    const base: AppState = {
      ...initialAppState,
      runsArchive: { ...initialAppState.runsArchive, shown: true },
    };
    const s = reducer(base, { type: "MODE_OPEN_RUN", runId: "r1" });
    expect(s.runsArchive.shown).toBe(true);
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
