// test/components/narrow-layout.test.ts
//
// P8-T2 §4.1 pure-logic tests for the narrow single-pane layout helper.

import { describe, it, expect } from "vitest";
import {
  NARROW_TIER_MAX,
  composeBreadcrumb,
  pickNarrowLevel,
} from "../../src/components/narrow-layout.js";

describe("NARROW_TIER_MAX", () => {
  it("is exactly 60", () => {
    expect(NARROW_TIER_MAX).toBe(60);
  });
});

describe("pickNarrowLevel", () => {
  it("browsing.runs → 'runs'", () => {
    expect(
      pickNarrowLevel({
        mode: { kind: "browsing", pane: "runs" },
        selectedStepId: null,
      }),
    ).toBe("runs");
  });

  it("viewing.graph with no selected step → 'steplist'", () => {
    expect(
      pickNarrowLevel({
        mode: { kind: "viewing", runId: "r1", focus: "graph" },
        selectedStepId: null,
      }),
    ).toBe("steplist");
  });

  it("viewing.graph with a selected step → 'stepdetail'", () => {
    expect(
      pickNarrowLevel({
        mode: { kind: "viewing", runId: "r1", focus: "graph" },
        selectedStepId: "build",
      }),
    ).toBe("stepdetail");
  });

  it("browsing.workflows → null (narrow rewrite does not apply)", () => {
    expect(
      pickNarrowLevel({
        mode: { kind: "browsing", pane: "workflows" },
        selectedStepId: null,
      }),
    ).toBeNull();
  });
});

describe("composeBreadcrumb", () => {
  it("'runs' level — just the prefix", () => {
    expect(composeBreadcrumb("runs", null, null, "\u203A")).toBe("Runs");
  });

  it("'steplist' level — prefix + runId", () => {
    expect(composeBreadcrumb("steplist", "ijkl56", null, "\u203A")).toBe(
      "Runs \u203A ijkl56",
    );
  });

  it("'stepdetail' level — prefix + runId + stepLabel", () => {
    expect(
      composeBreadcrumb("stepdetail", "ijkl56", "deploy-us", "\u203A"),
    ).toBe("Runs \u203A ijkl56 \u203A deploy-us");
  });

  it("ASCII separator '->'", () => {
    expect(composeBreadcrumb("stepdetail", "r", "s", "->")).toBe(
      "Runs -> r -> s",
    );
  });

  it("missing stepLabel at stepdetail → just runId", () => {
    expect(composeBreadcrumb("stepdetail", "ijkl56", null, "\u203A")).toBe(
      "Runs \u203A ijkl56",
    );
  });
});
