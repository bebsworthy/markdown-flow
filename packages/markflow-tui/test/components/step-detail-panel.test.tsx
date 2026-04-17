// test/components/step-detail-panel.test.tsx
//
// Ink-level tests for <StepDetailPanel>. Covers the three mockup layouts
// (§1 compact, §4 running, §6 terminal-failed) + empty / not-found states.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepDetailPanel } from "../../src/components/step-detail-panel.js";
import type {
  StepDetailField,
  StepDetailModel,
} from "../../src/steps/detail-types.js";

const THEME = buildTheme({ color: true, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderPanel(
  model: StepDetailModel,
  width: number = 133,
  height: number = 12,
): string {
  const { lastFrame } = render(
    <ThemeProvider value={THEME}>
      <StepDetailPanel model={model} width={width} height={height} />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

function f(key: string, value: string, layout: "pair" | "full" = "pair"): StepDetailField {
  return { key, label: key, value, layout };
}

describe("<StepDetailPanel> — empty / not-found", () => {
  it("empty model renders dim hint", () => {
    const frame = renderPanel({ kind: "empty" }, 80, 4);
    expect(frame).toContain("select a step to see details");
  });

  it("not-found model renders dim message with the row id", () => {
    const frame = renderPanel({ kind: "not-found", rowId: "xyz" }, 80, 4);
    expect(frame).toContain("step xyz no longer in run");
  });
});

describe("<StepDetailPanel> — running fixture (§4 parity)", () => {
  const runningModel: StepDetailModel = {
    kind: "token",
    data: {
      nodeId: "deploy-eu",
      tokenId: "t-eu",
      seq: 198,
      headline: "deploy-eu \u00b7 script (bash) \u00b7 seq=198",
      statusLine: null,
      role: "running",
      glyphKey: "running",
      fields: [
        f("type", "script (bash)"),
        f("attempt", "1/3"),
        f("timeout", "90s"),
        f("exit", "\u2014"),
        f("started", "12:04:07 (18s ago)"),
        f("edge", "\u2014"),
        f("local", `{ region: "eu-west-1", sha: "ab12cd" }`, "full"),
        f("global", `{ sha: "ab12cd", started: "\u2026" }`, "full"),
        f("last log", "seq=198  stdout  applying terraform plan", "full"),
      ],
      stderrTail: [],
      stderrTailNote: null,
    },
  };

  it("renders the headline", () => {
    const frame = renderPanel(runningModel, 133, 12);
    expect(frame).toContain("deploy-eu");
    expect(frame).toContain("script (bash)");
    expect(frame).toContain("seq=198");
  });

  it("renders pair rows (type + attempt + timeout + exit)", () => {
    const frame = renderPanel(runningModel, 133, 12);
    expect(frame).toContain("type");
    expect(frame).toContain("attempt");
    expect(frame).toContain("timeout");
    expect(frame).toContain("90s");
    expect(frame).toContain("1/3");
  });

  it("renders full-width local + last log", () => {
    const frame = renderPanel(runningModel, 133, 12);
    expect(frame).toContain(`{ region: "eu-west-1"`);
    expect(frame).toContain("applying terraform plan");
  });
});

describe("<StepDetailPanel> — terminal failed (§6 parity)", () => {
  const failedModel: StepDetailModel = {
    kind: "token",
    data: {
      nodeId: "deploy-us",
      tokenId: "t-us",
      seq: 214,
      headline: "deploy-us \u00b7 script (bash) \u00b7 seq=214",
      statusLine: "\u2717 failed (3/3 attempts \u00b7 exhausted)",
      role: "failed",
      glyphKey: "fail",
      fields: [
        f("type", "script (bash)"),
        f("attempt", "3/3 \u00b7 exhausted"),
        f("timeout", "60s"),
        f("exit", "1"),
        f("started", "12:03:06"),
        f("ended", "12:03:40"),
        f("edge", "fail:max  \u2192  rollback-us"),
        f("local", `{ region: "us-east-1", sha: "ab12cd" }`, "full"),
      ],
      stderrTail: [
        { seq: 210, text: "ssh: connect timed out" },
        { seq: 210, text: "error: region us-east unreachable" },
        { seq: 211, text: "retry budget 3/3 exhausted" },
      ],
      stderrTailNote: "(last 3 lines \u2014 `2` or Tab for full log)",
    },
  };

  it("renders the status line", () => {
    const frame = renderPanel(failedModel, 133, 14);
    expect(frame).toContain("failed");
    expect(frame).toContain("exhausted");
  });

  it("renders the exit + timeout + edge+route values", () => {
    const frame = renderPanel(failedModel, 133, 14);
    expect(frame).toContain("exit");
    expect(frame).toContain("60s");
    expect(frame).toContain("fail:max");
    expect(frame).toContain("rollback-us");
  });

  it("renders the stderr tail header and lines", () => {
    const frame = renderPanel(failedModel, 133, 14);
    expect(frame).toContain("stderr tail");
    expect(frame).toContain("ssh: connect timed out");
    expect(frame).toContain("error: region us-east unreachable");
    expect(frame).toContain("retry budget 3/3 exhausted");
  });
});

describe("<StepDetailPanel> — collapsed layout (height < 5)", () => {
  const model: StepDetailModel = {
    kind: "token",
    data: {
      nodeId: "n",
      tokenId: "t",
      seq: 1,
      headline: "n \u00b7 script (bash)",
      statusLine: null,
      role: "running",
      glyphKey: "running",
      fields: [f("type", "script (bash)")],
      stderrTail: [],
      stderrTailNote: null,
    },
  };

  it("renders the collapsed placeholder", () => {
    const frame = renderPanel(model, 80, 3);
    expect(frame).toContain("detail pane collapsed");
  });
});

describe("<StepDetailPanel> — aggregate variant", () => {
  const model: StepDetailModel = {
    kind: "aggregate",
    data: {
      batchId: "b1",
      nodeId: "deploy",
      headline: "batch [deploy] \u00b7 forEach \u00b7 2/3",
      role: "batch",
      glyphKey: "batch",
      fields: [
        f("status", "running"),
        f("items", "2 / 3"),
        f("succeeded", "1"),
        f("failed", "1"),
      ],
    },
  };

  it("renders the aggregate headline", () => {
    const frame = renderPanel(model, 100, 8);
    expect(frame).toContain("batch [deploy]");
    expect(frame).toContain("2/3");
    expect(frame).toContain("items");
  });
});
