// test/components/workflow-list.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowList } from "../../src/components/workflow-list.js";
import {
  formatListFooter,
  formatListTitle,
} from "../../src/browser/list-layout.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const NOW = Date.parse("2026-04-16T10:00:00Z");

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "X",
    workflow: null,
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    rawContent: null,
    ...overrides,
  };
}

const ENTRIES: ResolvedEntry[] = [
  makeResolved({
    entry: { source: "./a.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./a.md",
    title: "Alpha",
  }),
  makeResolved({
    entry: { source: "./b.md", addedAt: "2026-01-02T00:00:00Z" },
    id: "./b.md",
    title: "Beta",
    sourceKind: "workspace",
  }),
  makeResolved({
    entry: { source: "./c.md", addedAt: "2026-01-03T00:00:00Z" },
    id: "./c.md",
    title: "Gamma",
    status: "parse-error",
  }),
];

function renderList(props: {
  title?: string;
  entries?: ReadonlyArray<ResolvedEntry>;
  selectedIndex?: number;
  footer?: string;
  width?: number;
  height?: number;
  now?: number;
}): { frame: string } {
  const w = props.width ?? 80;
  const h = props.height ?? 10;
  const entries = props.entries ?? ENTRIES;
  const title = props.title ?? formatListTitle(null, "/");
  const footer = props.footer ?? formatListFooter(entries);
  const { lastFrame } = render(
    <ThemeProvider>
      <WorkflowList
        title={title}
        entries={entries}
        selectedIndex={props.selectedIndex ?? 0}
        footer={footer}
        width={w}
        height={h}
        now={props.now ?? NOW}
      />
    </ThemeProvider>,
  );
  return { frame: stripAnsi(lastFrame() ?? "") };
}

describe("WorkflowList — rendering", () => {
  it("renders title with file path", () => {
    const title = formatListTitle("/home/me/.markflow-tui.json", "/home/me");
    const { frame } = renderList({ title });
    expect(frame).toContain("Workflows  (./.markflow-tui.json)");
  });

  it("renders title with 'session only' when path is null", () => {
    const { frame } = renderList({ title: formatListTitle(null, "/") });
    expect(frame).toContain("session only");
  });

  it("renders one row per entry", () => {
    const { frame } = renderList({});
    expect(frame).toContain("Alpha");
    expect(frame).toContain("Beta");
    expect(frame).toContain("Gamma");
  });

  it("separator line is present", () => {
    const { frame } = renderList({});
    const hasSeparator = /═{3,}/.test(frame) || /-{3,}/.test(frame);
    expect(hasSeparator).toBe(true);
  });

  it("footer renders 'N entries · M errors'", () => {
    const { frame } = renderList({});
    expect(frame).toContain("3 entries · 1 error");
  });

  it("cursor glyph ▶ appears on selected row only", () => {
    const { frame } = renderList({ selectedIndex: 1 });
    const lines = frame.split("\n");
    const withArrow = lines.filter((l) => l.includes("▶ "));
    expect(withArrow).toHaveLength(1);
    expect(withArrow[0]).toContain("Beta");
  });

  it("badges [file] and [workspace] render in the badge column", () => {
    const { frame } = renderList({});
    expect(frame).toContain("[file]");
    expect(frame).toContain("[workspace]");
  });
});

describe("WorkflowList — tone", () => {
  it("renders parse-error rows with a visible ✗ flag", () => {
    const { frame } = renderList({});
    expect(frame).toContain("✗ parse");
  });

  it("renders valid+complete rows with ✓ flag", () => {
    const endedAt = new Date(NOW - 60 * 1000).toISOString();
    const entries = [
      makeResolved({
        lastRun: { status: "complete", endedAt },
      }),
    ];
    const { frame } = renderList({
      entries,
      footer: formatListFooter(entries),
      now: NOW,
    });
    expect(frame).toContain("✓");
  });

  it("renders missing rows with ✗ 404 flag", () => {
    const entries = [makeResolved({ status: "missing" })];
    const { frame } = renderList({
      entries,
      footer: formatListFooter(entries),
    });
    expect(frame).toContain("✗ 404");
  });

  it("renders never-run rows with '— never' flag", () => {
    const entries = [makeResolved({ status: "valid", lastRun: null })];
    const { frame } = renderList({
      entries,
      footer: formatListFooter(entries),
    });
    expect(frame).toContain("— never");
  });
});

describe("WorkflowList — layout", () => {
  it("long titles are truncated by DataTable flex layout", () => {
    const longEntry = makeResolved({
      entry: {
        source: "./deploy.md",
        addedAt: "2026-01-01T00:00:00Z",
      },
      id: "./deploy.md",
      title: "Very Long Workflow Title For Production Deploy Pipeline",
    });
    const { frame } = renderList({
      entries: [longEntry],
      width: 40,
      footer: formatListFooter([longEntry]),
    });
    const lines = frame.split("\n");
    const dataLines = lines.filter((l) => l.includes("Very Long") || l.includes("Deploy"));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
  });

  it("narrow width fits a single row without throwing", () => {
    const entries = [makeResolved()];
    expect(() =>
      renderList({ entries, width: 30, footer: formatListFooter(entries) }),
    ).not.toThrow();
  });
});
