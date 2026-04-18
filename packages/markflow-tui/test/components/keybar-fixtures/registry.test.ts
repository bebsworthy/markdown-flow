// test/components/keybar-fixtures/registry.test.ts
import { describe, it, expect } from "vitest";
import { selectKeybarFixture } from "../../../src/components/keybar-fixtures/registry.js";
import { APPROVAL_KEYBAR } from "../../../src/components/keybar-fixtures/approval.js";
import { COMMAND_KEYBAR } from "../../../src/components/keybar-fixtures/command.js";
import {
  EVENTS_FOLLOWING_KEYBAR,
  EVENTS_PAUSED_KEYBAR,
} from "../../../src/components/keybar-fixtures/events.js";
import { GRAPH_KEYBAR } from "../../../src/components/keybar-fixtures/graph.js";
import { HELP_KEYBAR } from "../../../src/components/keybar-fixtures/help.js";
import {
  LOG_FOLLOWING_KEYBAR,
  LOG_PAUSED_KEYBAR,
} from "../../../src/components/keybar-fixtures/log.js";
import { RESUME_KEYBAR } from "../../../src/components/keybar-fixtures/resume.js";
import { WORKFLOWS_EMPTY_KEYBAR } from "../../../src/components/keybar-fixtures/workflows-empty.js";
import type { AppState } from "../../../src/state/types.js";

const browsingWorkflows: AppState["mode"] = {
  kind: "browsing",
  pane: "workflows",
};
const browsingRuns: AppState["mode"] = { kind: "browsing", pane: "runs" };
const viewingGraph: AppState["mode"] = {
  kind: "viewing",
  runId: "r1",
  focus: "graph",
  runsDir: "/tmp/runs",
};

describe("selectKeybarFixture", () => {
  it("approval overlay → APPROVAL_KEYBAR + APPROVAL pill", () => {
    const sel = selectKeybarFixture({
      mode: viewingGraph,
      overlay: { kind: "approval", runId: "r1", nodeId: "n1", state: "idle" },
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(APPROVAL_KEYBAR);
    expect(sel.modePill).toBe("APPROVAL");
    expect(sel.modeLabel).toBe("APPROVAL");
  });

  it("resumeWizard overlay → RESUME_KEYBAR + RESUME pill", () => {
    const sel = selectKeybarFixture({
      mode: viewingGraph,
      overlay: {
        kind: "resumeWizard",
        runId: "r1",
        rerun: new Set(),
        inputs: {},
        state: "idle",
      },
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(RESUME_KEYBAR);
    expect(sel.modePill).toBe("RESUME");
  });

  it("commandPalette overlay → COMMAND_KEYBAR + COMMAND pill", () => {
    const sel = selectKeybarFixture({
      mode: browsingWorkflows,
      overlay: { kind: "commandPalette", query: "" },
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(COMMAND_KEYBAR);
    expect(sel.modePill).toBe("COMMAND");
  });

  it("help overlay → HELP_KEYBAR + HELP pill", () => {
    const sel = selectKeybarFixture({
      mode: browsingWorkflows,
      overlay: { kind: "help" },
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(HELP_KEYBAR);
    expect(sel.modePill).toBe("HELP");
  });

  it("browsing.workflows with empty registry → WORKFLOWS_EMPTY_KEYBAR", () => {
    const sel = selectKeybarFixture({
      mode: browsingWorkflows,
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: true,
    });
    expect(sel.bindings).toBe(WORKFLOWS_EMPTY_KEYBAR);
    expect(sel.modeLabel).toBe("WORKFLOWS");
  });

  it("browsing.runs → RUNS label", () => {
    const sel = selectKeybarFixture({
      mode: browsingRuns,
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.modeLabel).toBe("RUNS");
  });

  it("viewing.graph → GRAPH_KEYBAR + RUN label + graph focus", () => {
    const sel = selectKeybarFixture({
      mode: viewingGraph,
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(GRAPH_KEYBAR);
    expect(sel.modeLabel).toBe("RUN");
    expect(sel.focusLabel).toBe("graph");
  });

  it("viewing.log + following → LOG_FOLLOWING_KEYBAR", () => {
    const sel = selectKeybarFixture({
      mode: { kind: "viewing", runId: "r1", focus: "log", runsDir: "/tmp/runs" },
      overlay: null,
      logFollowing: true,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(LOG_FOLLOWING_KEYBAR);
  });

  it("viewing.log + paused → LOG_PAUSED_KEYBAR", () => {
    const sel = selectKeybarFixture({
      mode: { kind: "viewing", runId: "r1", focus: "log", runsDir: "/tmp/runs" },
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(LOG_PAUSED_KEYBAR);
  });

  it("viewing.events following/paused → correct fixture", () => {
    const follow = selectKeybarFixture({
      mode: { kind: "viewing", runId: "r1", focus: "events", runsDir: "/tmp/runs" },
      overlay: null,
      logFollowing: false,
      eventsFollowing: true,
      registryEmpty: false,
    });
    expect(follow.bindings).toBe(EVENTS_FOLLOWING_KEYBAR);
    const paused = selectKeybarFixture({
      mode: { kind: "viewing", runId: "r1", focus: "events", runsDir: "/tmp/runs" },
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(paused.bindings).toBe(EVENTS_PAUSED_KEYBAR);
  });

  it("viewing.detail reuses GRAPH_KEYBAR", () => {
    const sel = selectKeybarFixture({
      mode: { kind: "viewing", runId: "r1", focus: "detail", runsDir: "/tmp/runs" },
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    });
    expect(sel.bindings).toBe(GRAPH_KEYBAR);
    expect(sel.focusLabel).toBe("detail");
  });

  it("is deterministic — same args yield same selection shape", () => {
    const args = {
      mode: viewingGraph,
      overlay: null,
      logFollowing: false,
      eventsFollowing: false,
      registryEmpty: false,
    } as const;
    const a = selectKeybarFixture(args);
    const b = selectKeybarFixture(args);
    expect(a.bindings).toBe(b.bindings);
    expect(a.modeLabel).toBe(b.modeLabel);
    expect(a.focusLabel).toBe(b.focusLabel);
  });
});
