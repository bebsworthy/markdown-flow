// test/components/log-panel.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { LogPanel } from "../../src/components/log-panel.js";
import type { LogPanelModel, LogPanelRow } from "../../src/log/types.js";

const THEME = buildTheme({ color: true, unicode: true });

function renderPanel(
  model: LogPanelModel,
  width: number,
  height: number,
): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={THEME}>
      <LogPanel model={model} width={width} height={height} />
    </ThemeProvider>,
  );
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function row(i: number, text: string): LogPanelRow {
  return {
    line: {
      seq: 10,
      lineIndex: i,
      stream: "stdout",
      ts: null,
      segments: [{ text }],
      rawLength: text.length,
    },
    text,
  };
}

function followModel(): LogPanelModel {
  return {
    header: "Log · build · seq=10 · following",
    banner: null,
    rows: [row(0, "hello"), row(1, "world")],
    footer: { kind: "live-tail" },
    empty: null,
    isFollowing: true,
  };
}

function pausedModel(): LogPanelModel {
  return {
    header: "Log · build · seq=10 · paused",
    banner: { kind: "paused", linesSincePause: 12 },
    rows: [row(0, "hello"), row(1, "world")],
    footer: { kind: "more-below", hidden: 5 },
    empty: null,
    isFollowing: false,
  };
}

describe("<LogPanel>", () => {
  it("renders header + rows + live-tail footer in follow mode", () => {
    const { lastFrame } = renderPanel(followModel(), 60, 10);
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("following");
    expect(out).toContain("hello");
    expect(out).toContain("world");
    expect(out).toContain("live");
  });

  it("renders paused banner and more-below footer when paused", () => {
    const { lastFrame } = renderPanel(pausedModel(), 60, 10);
    const out = stripAnsi(lastFrame() ?? "");
    expect(out).toContain("paused");
    expect(out).toContain("12 new lines since pause");
    expect(out).toContain("more below");
  });

  it("renders empty state with dim copy", () => {
    const empty: LogPanelModel = {
      header: "",
      banner: null,
      rows: [],
      footer: null,
      empty: { kind: "no-selection" },
      isFollowing: false,
    };
    const { lastFrame } = renderPanel(empty, 60, 10);
    expect(stripAnsi(lastFrame() ?? "")).toContain(
      "select a step to see its log",
    );
  });

  it("renders pending empty state", () => {
    const empty: LogPanelModel = {
      header: "",
      banner: null,
      rows: [],
      footer: null,
      empty: { kind: "pending" },
      isFollowing: false,
    };
    const { lastFrame } = renderPanel(empty, 60, 10);
    expect(stripAnsi(lastFrame() ?? "")).toContain("waiting for step to start");
  });

  it("returns null for zero-sized viewport", () => {
    const { lastFrame } = renderPanel(followModel(), 0, 10);
    expect(stripAnsi(lastFrame() ?? "").trim()).toBe("");
  });
});
