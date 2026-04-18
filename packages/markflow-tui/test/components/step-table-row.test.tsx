// test/components/step-table-row.test.tsx
//
// Single-row snapshot tests for <StepTableRow>. Covers cursor glyph,
// depth indentation, status coloring, batch-aggregate prefix, progress-bar
// rendering, ASCII fallback, and truncation behavior.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepTableRow } from "../../src/components/step-table-row.js";
import { STEP_COLUMNS_WIDE } from "../../src/steps/columns.js";
import type { StepRow } from "../../src/steps/types.js";

const COLOR_UNICODE_THEME = buildTheme({ color: true, unicode: true });
const COLOR_ASCII_THEME = buildTheme({ color: true, unicode: false });

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function leafRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    id: overrides.id ?? "t1",
    kind: "leaf",
    depth: overrides.depth ?? 0,
    label: overrides.label ?? "build",
    status: overrides.status ?? "running",
    attempt: overrides.attempt ?? "1/3",
    elapsed: overrides.elapsed ?? "14s",
    elapsedMs: overrides.elapsedMs ?? 14_000,
    note: overrides.note ?? "",
    role: overrides.role ?? "running",
    glyphKey: overrides.glyphKey ?? "running",
    tokenId: overrides.tokenId ?? "t1",
    nodeId: overrides.nodeId ?? "build",
  };
}

function aggregateRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    id: overrides.id ?? "batch:b1",
    kind: "batch-aggregate",
    depth: overrides.depth ?? 1,
    label: overrides.label ?? "⟳ batch [regions]",
    status: overrides.status ?? "running",
    attempt: "\u2014",
    elapsed: overrides.elapsed ?? "30s",
    elapsedMs: overrides.elapsedMs ?? 30_000,
    note: overrides.note ?? "",
    role: overrides.role ?? "running",
    glyphKey: overrides.glyphKey ?? "batch",
    nodeId: overrides.nodeId ?? "regions",
    aggregate: overrides.aggregate ?? {
      batchId: "b1",
      nodeId: "regions",
      label: "batch [regions]",
      expected: 3,
      completed: 2,
      succeeded: 2,
      failed: 0,
      retries: 1,
      status: "running",
      earliestStartedAt: "2026-04-17T11:58:00Z",
    },
  };
}

function renderRow(
  row: StepRow,
  opts: { selected?: boolean; width?: number; ascii?: boolean } = {},
): string {
  const theme = opts.ascii ? COLOR_ASCII_THEME : COLOR_UNICODE_THEME;
  const { lastFrame } = render(
    <ThemeProvider value={theme}>
      <StepTableRow
        row={row}
        columns={STEP_COLUMNS_WIDE}
        selected={opts.selected ?? false}
        width={opts.width ?? 140}
      />
    </ThemeProvider>,
  );
  return lastFrame() ?? "";
}

describe("<StepTableRow> cursor", () => {
  it("renders '▶' cursor prefix when selected", () => {
    // Use complete status (not running → has no `▶` status glyph).
    // NOTE: Ink 7 / Yoga v3 collapses the trailing space between the cursor
    // `<Text>{"▶ "}</Text>` and the first fixed-width column, so we just
    // assert the arrow is the first char.
    const row = leafRow({ status: "complete", glyphKey: "ok", role: "complete" });
    const frame = stripAnsi(renderRow(row, { selected: true }));
    expect(frame.startsWith("\u25b6")).toBe(true);
  });

  it("does NOT render the '▶' glyph as a cursor when not selected", () => {
    // With complete status (no running glyph), the first character should
    // be whitespace, not the '▶' selection marker.
    const row = leafRow({ status: "complete", glyphKey: "ok", role: "complete" });
    const frame = stripAnsi(renderRow(row, { selected: false }));
    expect(frame.startsWith("\u25b6")).toBe(false);
  });
});

describe("<StepTableRow> leaf indentation", () => {
  it("depth 2 → STEP column contains 4-space indent before the label", () => {
    const row = leafRow({ depth: 2, label: "deploy" });
    const frame = stripAnsi(renderRow(row));
    // The indent is "  ".repeat(2) + "deploy". Check that the exact padded
    // STEP cell appears (STEP column width is 28).
    expect(frame).toContain("    deploy");
  });

  it("depth 0 → no indentation before the label", () => {
    const row = leafRow({ depth: 0, label: "build" });
    const frame = stripAnsi(renderRow(row));
    // The STEP cell starts with the bare label when depth=0 (cursor is the
    // only prefix).
    expect(frame).toMatch(/^\s{0,2}build/);
  });
});

describe("<StepTableRow> status", () => {
  it("uses the theme-resolved glyph for the status column", () => {
    const row = leafRow({ status: "running", glyphKey: "running", role: "running" });
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("\u25b6"); // running glyph
    expect(frame).toContain("running"); // status label
  });

  it("complete row uses 'ok' label + ✓ glyph", () => {
    const row = leafRow({
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      note: "\u2192 next",
    });
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("\u2713");
    expect(frame).toContain("ok");
  });

  it("failed row uses 'failed' label + ✗ glyph", () => {
    const row = leafRow({
      status: "failed",
      glyphKey: "fail",
      role: "failed",
      note: "edge: fail (exit 1)",
    });
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("\u2717");
    expect(frame).toContain("failed");
  });
});

describe("<StepTableRow> batch aggregate", () => {
  it("STEP column uses theme.glyphs.batch prefix ('⟳ batch [regions]')", () => {
    const row = aggregateRow({ depth: 1 });
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("\u27f3 batch [regions]");
  });

  it("NOTE column renders composite count + progress bar + suffix", () => {
    const row = aggregateRow();
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("2 / 3");
    expect(frame).toContain("\u2588\u2588\u2588\u2588\u2588\u2588"); // ≥6 filled blocks
    expect(frame).toContain("1 retry \u00b7 0 failed");
  });

  it("NOTE column on FAILED aggregate uses theme fail/waiting glyphs", () => {
    const row = aggregateRow({
      status: "failed",
      role: "failed",
      aggregate: {
        batchId: "b1",
        nodeId: "regions",
        label: "batch [regions]",
        expected: 3,
        completed: 3,
        succeeded: 2,
        failed: 1,
        retries: 0,
        status: "failed",
        earliestStartedAt: "2026-04-17T11:58:00Z",
      },
    });
    const frame = stripAnsi(renderRow(row));
    expect(frame).toContain("1 \u2717 \u00b7 0 \u23f8");
  });

  it("ASCII theme → progress-bar uses '#' / '.'", () => {
    const row = aggregateRow();
    const frame = stripAnsi(renderRow(row, { ascii: true }));
    expect(frame).toContain("2 / 3");
    expect(frame).toContain("######...");
  });
});

describe("<StepTableRow> truncation", () => {
  it("cell that overflows column width → ellipsis '…'", () => {
    const row = leafRow({
      label:
        "this-is-a-really-long-node-label-that-will-definitely-overflow-the-step-column-28-chars",
    });
    // Wide column width for STEP is 28. Overflow should produce an ellipsis.
    const frame = stripAnsi(renderRow(row, { width: 140 }));
    expect(frame).toContain("\u2026");
  });
});
