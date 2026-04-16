// test/components/runs-table-row.test.tsx
//
// Single-row snapshot tests for <RunsTableRow>. Exercises cursor glyph,
// status coloring, and fit/truncate behavior within a column.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { RunInfo, StepResult } from "markflow";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { RunsTableRow } from "../../src/components/runs-table-row.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import { COLUMNS_140, COLUMNS_80 } from "../../src/runs/columns.js";

// Force color+unicode theme so the row renders with ANSI color escapes and
// Unicode glyphs — the test env is non-TTY by default, so we need to inject
// a theme to make status-role color assertions meaningful.
const COLOR_UNICODE_THEME = buildTheme({ color: true, unicode: true });

const NOW = Date.parse("2026-04-17T12:00:00Z");

function step(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "build",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "success",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T11:55:00Z",
    completed_at: overrides.completed_at ?? "2026-04-17T11:55:30Z",
    exit_code: overrides.exit_code ?? 0,
  };
}

function mkRow(overrides: Partial<RunInfo>) {
  const base: RunInfo = {
    id: overrides.id ?? "r0000001",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "./deploy.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
  return toRunsTableRow(base, NOW);
}

function renderRow(props: {
  row: ReturnType<typeof mkRow>;
  selected?: boolean;
  width?: number;
  columns?: typeof COLUMNS_140 | typeof COLUMNS_80;
}): { frame: string } {
  const { lastFrame } = render(
    <ThemeProvider value={COLOR_UNICODE_THEME}>
      <RunsTableRow
        row={props.row}
        columns={props.columns ?? COLUMNS_80}
        selected={props.selected ?? false}
        width={props.width ?? 80}
      />
    </ThemeProvider>,
  );
  const raw = lastFrame() ?? "";
  return { frame: raw };
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("<RunsTableRow> — cursor", () => {
  it("renders '▶ ' as the line-leading cursor glyph when selected", () => {
    // Use a complete row so the STATUS column doesn't also emit `▶`
    // (running glyph).
    const row = mkRow({
      id: "r0000001",
      status: "complete",
      completedAt: "2026-04-17T11:30:00Z",
    });
    const { frame } = renderRow({ row, selected: true });
    expect(stripAnsi(frame)).toMatch(/^▶ /);
  });

  it("renders two leading spaces when not selected", () => {
    const row = mkRow({
      id: "r0000001",
      status: "complete",
      completedAt: "2026-04-17T11:30:00Z",
    });
    const { frame } = renderRow({ row, selected: false });
    const stripped = stripAnsi(frame);
    expect(stripped.startsWith("  ")).toBe(true);
    expect(stripped).not.toContain("▶");
  });
});

describe("<RunsTableRow> — status coloring", () => {
  it("running rows render the running glyph + label", () => {
    // Injected color+unicode theme resolves the `▶` glyph; the 12-col
    // STATUS cell fits `▶ running` exactly.
    const row = mkRow({ status: "running" });
    const { frame } = renderRow({ row });
    const stripped = stripAnsi(frame);
    expect(stripped).toContain("▶");
    expect(stripped).toContain("running");
  });

  it("error rows render the fail glyph + 'failed' label", () => {
    // ANSI color emission depends on chalk's supports-color detection (not
    // the injected theme), which varies by test runner. The theme-role
    // plumbing is covered by unit tests in test/runs/derive.test.ts; here
    // we assert the glyph + label semantics.
    const row = mkRow({
      status: "error",
      completedAt: "2026-04-17T11:59:00Z",
      steps: [step({ exit_code: 1, summary: "oops" })],
    });
    const { frame } = renderRow({ row });
    const stripped = stripAnsi(frame);
    expect(stripped).toContain("✗");
    expect(stripped).toContain("failed");
  });

  it("complete rows render 'ok' label", () => {
    const row = mkRow({
      status: "complete",
      completedAt: "2026-04-17T11:30:00Z",
    });
    const { frame } = renderRow({ row });
    expect(stripAnsi(frame)).toContain("ok");
  });
});

describe("<RunsTableRow> — fit/truncate", () => {
  it("truncates long workflow names with an ellipsis", () => {
    const row = mkRow({ workflowName: "a-very-very-long-workflow-name" });
    const { frame } = renderRow({ row });
    expect(stripAnsi(frame)).toContain("…");
  });

  it("note column absorbs leftover width in the narrow set", () => {
    const row = mkRow({
      status: "error",
      completedAt: "2026-04-17T11:59:00Z",
      steps: [
        step({
          summary: "db down",
          exit_code: 1,
        }),
      ],
    });
    const { frame } = renderRow({ row, columns: COLUMNS_80, width: 80 });
    // NOTE column gets the grow slot; at width 80 there's room for short
    // messages without ellipsis.
    expect(stripAnsi(frame)).toContain("db down");
  });
});
