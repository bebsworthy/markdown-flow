// test/components/workflow-list.test.tsx

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { WorkflowList } from "../../src/components/workflow-list.js";
import {
  composeListRows,
  formatListFooter,
  formatListTitle,
} from "../../src/browser/list-layout.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

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
    ...overrides,
  };
}

const ENTRIES: ResolvedEntry[] = [
  makeResolved({
    entry: { source: "./a.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./a.md",
  }),
  makeResolved({
    entry: { source: "./b.md", addedAt: "2026-01-02T00:00:00Z" },
    id: "./b.md",
    sourceKind: "workspace",
  }),
  makeResolved({
    entry: { source: "./c.md", addedAt: "2026-01-03T00:00:00Z" },
    id: "./c.md",
    status: "parse-error",
  }),
];

function renderList(props: {
  title?: string;
  rows?: ReturnType<typeof composeListRows>;
  footer?: string;
  width?: number;
  height?: number;
}): { frame: string } {
  const w = props.width ?? 80;
  const h = props.height ?? 10;
  const rows = props.rows ?? composeListRows(ENTRIES, 0, w);
  const title = props.title ?? formatListTitle(null, "/");
  const footer = props.footer ?? formatListFooter(ENTRIES);
  const { lastFrame } = render(
    <ThemeProvider>
      <WorkflowList
        title={title}
        rows={rows}
        footer={footer}
        width={w}
        height={h}
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
    expect(frame).toContain("./a.md");
    expect(frame).toContain("./b.md");
    expect(frame).toContain("./c.md");
  });

  it("separator line is present", () => {
    const { frame } = renderList({});
    // Theme emits either ═ (unicode) or - (ASCII) as the separator — both
    // acceptable. Presence of a run of either satisfies.
    const hasSeparator = /═{3,}/.test(frame) || /-{3,}/.test(frame);
    expect(hasSeparator).toBe(true);
  });

  it("footer renders 'N entries · M errors'", () => {
    const { frame } = renderList({});
    expect(frame).toContain("3 entries · 1 error");
  });

  it("cursor glyph ▶ appears on selected row only", () => {
    const rows = composeListRows(ENTRIES, 1, 80);
    const { frame } = renderList({ rows });
    const lines = frame.split("\n");
    // Exactly one line should contain ▶ followed by a space.
    const withArrow = lines.filter((l) => l.includes("▶ "));
    expect(withArrow).toHaveLength(1);
    expect(withArrow[0]).toContain("./b.md");
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
    const now = Date.parse("2026-04-16T10:00:00Z");
    const endedAt = new Date(now - 60 * 1000).toISOString();
    const entries = [
      makeResolved({
        lastRun: { status: "complete", endedAt },
      }),
    ];
    const rows = composeListRows(entries, 0, 80);
    const { frame } = renderList({
      rows,
      footer: formatListFooter(entries),
    });
    expect(frame).toContain("✓");
  });

  it("renders missing rows with ✗ 404 flag", () => {
    const entries = [makeResolved({ status: "missing" })];
    const rows = composeListRows(entries, 0, 80);
    const { frame } = renderList({
      rows,
      footer: formatListFooter(entries),
    });
    expect(frame).toContain("✗ 404");
  });

  it("renders never-run rows with '— never' flag", () => {
    const entries = [makeResolved({ status: "valid", lastRun: null })];
    const rows = composeListRows(entries, 0, 80);
    const { frame } = renderList({
      rows,
      footer: formatListFooter(entries),
    });
    expect(frame).toContain("— never");
  });
});

describe("WorkflowList — layout", () => {
  it("truncates long source strings with middle ellipsis", () => {
    const longEntry = makeResolved({
      entry: {
        source: "./very/long/path/to/some/flow/deeply/nested/deploy.md",
        addedAt: "2026-01-01T00:00:00Z",
      },
      id: "./very/long/path/to/some/flow/deeply/nested/deploy.md",
    });
    const rows = composeListRows([longEntry], 0, 40);
    const { frame } = renderList({
      rows,
      width: 40,
      footer: formatListFooter([longEntry]),
    });
    // Either full path (unlikely at 40 cols) or the ellipsis + basename is shown.
    expect(frame).toContain("…");
  });

  it("narrow width fits a single row (flag column may be truncated)", () => {
    const entries = [makeResolved()];
    const rows = composeListRows(entries, 0, 30);
    expect(() =>
      renderList({ rows, width: 30, footer: formatListFooter(entries) }),
    ).not.toThrow();
  });
});
