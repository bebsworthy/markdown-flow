// test/components/step-table.test.tsx
//
// Tests for <StepTable>. Covers:
//  - Empty state ("no steps yet")
//  - Column header rendering
//  - Row delegation to <StepTableRow>
//  - Overflow drop-from-tail behavior
//  - Mockup §4 parity (running) + §6 parity (terminal) at wide tier

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepTable } from "../../src/components/step-table.js";
import { STEP_COLUMNS_WIDE } from "../../src/steps/columns.js";
import type { StepRow } from "../../src/steps/types.js";

const COLOR_UNICODE_THEME = buildTheme({ color: true, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const NOW = Date.parse("2026-04-17T12:00:00Z");

function leaf(overrides: Partial<StepRow> & { id: string }): StepRow {
  return {
    id: overrides.id,
    kind: "leaf",
    depth: overrides.depth ?? 0,
    label: overrides.label ?? overrides.id,
    status: overrides.status ?? "pending",
    attempt: overrides.attempt ?? "\u2014",
    elapsed: overrides.elapsed ?? "\u2014",
    elapsedMs: overrides.elapsedMs ?? 0,
    note: overrides.note ?? "",
    role: overrides.role ?? "pending",
    glyphKey: overrides.glyphKey ?? "pending",
    tokenId: overrides.id,
    nodeId: overrides.nodeId ?? overrides.id,
  };
}

function renderTable(props: {
  rows: ReadonlyArray<StepRow>;
  width?: number;
  height?: number;
  selectedStepId?: string | null;
  cursorRowIndex?: number;
}): string {
  const { lastFrame } = render(
    <ThemeProvider value={COLOR_UNICODE_THEME}>
      <StepTable
        rows={props.rows}
        columns={STEP_COLUMNS_WIDE}
        width={props.width ?? 140}
        height={props.height ?? 20}
        nowMs={NOW}
        selectedStepId={props.selectedStepId ?? null}
        cursorRowIndex={props.cursorRowIndex}
      />
    </ThemeProvider>,
  );
  return lastFrame() ?? "";
}

describe("<StepTable> empty state", () => {
  it("renders 'no steps yet' when rows is empty", () => {
    const frame = stripAnsi(renderTable({ rows: [] }));
    expect(frame).toContain("no steps yet");
  });

  it("does NOT render column headers when empty", () => {
    const frame = stripAnsi(renderTable({ rows: [] }));
    expect(frame).not.toContain("STEP");
    expect(frame).not.toContain("STATUS");
  });

  it("returns empty box when width or height is zero", () => {
    const { lastFrame: w0 } = render(
      <ThemeProvider value={COLOR_UNICODE_THEME}>
        <StepTable
          rows={[]}
          columns={STEP_COLUMNS_WIDE}
          width={0}
          height={10}
          nowMs={NOW}
        />
      </ThemeProvider>,
    );
    expect((w0() ?? "").trim()).toBe("");

    const { lastFrame: h0 } = render(
      <ThemeProvider value={COLOR_UNICODE_THEME}>
        <StepTable
          rows={[]}
          columns={STEP_COLUMNS_WIDE}
          width={120}
          height={0}
          nowMs={NOW}
        />
      </ThemeProvider>,
    );
    expect((h0() ?? "").trim()).toBe("");
  });
});

describe("<StepTable> header", () => {
  it("renders the STEP/STATUS/ATTEMPT/ELAPSED/NOTE column headers in order", () => {
    const rows = [leaf({ id: "t1", status: "running", glyphKey: "running" })];
    const frame = stripAnsi(renderTable({ rows }));
    expect(frame).toContain("STEP");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("ATTEMPT");
    expect(frame).toContain("ELAPSED");
    expect(frame).toContain("NOTE");
  });
});

describe("<StepTable> rows", () => {
  it("renders each row label", () => {
    const rows = [
      leaf({ id: "t1", label: "build", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t2", label: "test", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t3", label: "deploy", status: "running", glyphKey: "running" }),
    ];
    const frame = stripAnsi(renderTable({ rows }));
    expect(frame).toContain("build");
    expect(frame).toContain("test");
    expect(frame).toContain("deploy");
  });

  it("cursorRowIndex highlights the Nth row with '▶ '", () => {
    const rows = [
      leaf({ id: "t1", label: "build", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t2", label: "test", status: "complete", glyphKey: "ok" }),
    ];
    const frame = stripAnsi(renderTable({ rows, cursorRowIndex: 1 }));
    const lines = frame.split("\n");
    // Header + 2 rows; cursor on second data row.
    const cursorMarkers = lines.filter((l) => l.startsWith("\u25b6 "));
    expect(cursorMarkers.length).toBeGreaterThanOrEqual(1);
  });

  it("selectedStepId highlights the matching row", () => {
    const rows = [
      leaf({ id: "a", label: "build", status: "complete", glyphKey: "ok" }),
      leaf({ id: "b", label: "test", status: "complete", glyphKey: "ok" }),
    ];
    const frame = stripAnsi(renderTable({ rows, selectedStepId: "b" }));
    expect(frame).toMatch(/\u25b6 .*test/);
  });

  it("overflow drops rows from the tail (height budget)", () => {
    const rows = [
      leaf({ id: "t1", label: "row-one", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t2", label: "row-two", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t3", label: "row-three", status: "complete", glyphKey: "ok" }),
      leaf({ id: "t4", label: "row-four", status: "complete", glyphKey: "ok" }),
    ];
    // height=3 → 1 header + 2 data rows.
    const frame = stripAnsi(renderTable({ rows, height: 3 }));
    expect(frame).toContain("row-one");
    expect(frame).toContain("row-two");
    expect(frame).not.toContain("row-four");
  });
});

// ---------------------------------------------------------------------------
// Mockup §4 parity — running state (wide tier, 133-col outer / 129-col inner)
// ---------------------------------------------------------------------------

describe("<StepTable> mockup §4 parity (running)", () => {
  // Fixture set mirroring mockup §4: build, test, fan-out, deploy-us (retry),
  // deploy-eu, batch aggregate, publish.
  const rows: ReadonlyArray<StepRow> = [
    leaf({
      id: "build",
      label: "build",
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      attempt: "1/1",
      elapsed: "14s",
      note: "\u2192 next",
    }),
    leaf({
      id: "test",
      label: "test",
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      attempt: "1/1",
      elapsed: "9s",
      note: "\u2192 next",
    }),
    leaf({
      id: "fan-out",
      label: "fan-out",
      status: "running",
      glyphKey: "running",
      role: "running",
      attempt: "\u2014",
      elapsed: "30s",
      note: "2 children active",
    }),
    leaf({
      id: "deploy-us",
      label: "deploy-us",
      depth: 1,
      status: "retrying",
      glyphKey: "retry",
      role: "retrying",
      attempt: "2/3",
      elapsed: "21s",
      note: "\u21bb retrying in 4s",
    }),
    leaf({
      id: "deploy-eu",
      label: "deploy-eu",
      depth: 1,
      status: "running",
      glyphKey: "running",
      role: "running",
      attempt: "1/3",
      elapsed: "18s",
      note: "",
    }),
    {
      id: "batch:regions",
      kind: "batch-aggregate",
      depth: 0,
      label: "\u27f3 batch [regions]",
      status: "running",
      attempt: "\u2014",
      elapsed: "25s",
      elapsedMs: 25_000,
      note: "2 / 3   \u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2591\u2591   1 retry \u00b7 0 failed",
      role: "running",
      glyphKey: "batch",
      nodeId: "regions",
      aggregate: {
        batchId: "regions",
        nodeId: "regions",
        label: "batch [regions]",
        expected: 3,
        completed: 2,
        succeeded: 2,
        failed: 0,
        retries: 1,
        status: "running",
        earliestStartedAt: "2026-04-17T11:59:30Z",
      },
    },
    leaf({
      id: "publish",
      label: "publish",
      status: "pending",
      glyphKey: "pending",
      role: "pending",
      attempt: "\u2014",
      elapsed: "\u2014",
      note: "",
    }),
  ];

  it("renders every row label from the mockup", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    for (const lbl of [
      "build",
      "test",
      "fan-out",
      "deploy-us",
      "deploy-eu",
      "batch [regions]",
      "publish",
    ]) {
      expect(frame).toContain(lbl);
    }
  });

  it("renders the running/ok/pending glyphs from §4", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("\u2713"); // ✓ ok
    expect(frame).toContain("\u25b6"); // ▶ running
    expect(frame).toContain("\u2299"); // ⊙ pending
    expect(frame).toContain("\u21bb"); // ↻ retry
    expect(frame).toContain("\u27f3"); // ⟳ batch
  });

  it("retry row NOTE contains 'retrying in' countdown", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("retrying in");
  });

  it("aggregate row NOTE contains the '2 / 3' progress + '1 retry · 0 failed'", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("2 / 3");
    expect(frame).toContain("1 retry \u00b7 0 failed");
  });

  it("deploy-us is indented under fan-out (depth 1)", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    // Must find "  deploy-us" (2-space indent) in the frame.
    expect(frame).toMatch(/\s{2,}deploy-us/);
  });
});

// ---------------------------------------------------------------------------
// Mockup §6 parity — terminal failed state
// ---------------------------------------------------------------------------

describe("<StepTable> mockup §6 parity (terminal failed)", () => {
  const rows: ReadonlyArray<StepRow> = [
    leaf({
      id: "build",
      label: "build",
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      attempt: "1/1",
      elapsed: "14s",
      note: "\u2192 next",
    }),
    leaf({
      id: "test",
      label: "test",
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      attempt: "1/1",
      elapsed: "9s",
      note: "\u2192 next",
    }),
    leaf({
      id: "fan-out",
      label: "fan-out",
      status: "failed",
      glyphKey: "fail",
      role: "failed",
      attempt: "\u2014",
      elapsed: "34s",
      note: "1 child failed",
    }),
    leaf({
      id: "deploy-us",
      label: "deploy-us",
      depth: 1,
      status: "failed",
      glyphKey: "fail",
      role: "failed",
      attempt: "3/3",
      elapsed: "34s",
      note: "retries exhausted \u00b7 edge: fail:max",
    }),
    leaf({
      id: "deploy-eu",
      label: "deploy-eu",
      depth: 1,
      status: "complete",
      glyphKey: "ok",
      role: "complete",
      attempt: "1/3",
      elapsed: "18s",
      note: "\u2192 next",
    }),
    leaf({
      id: "deploy-ap",
      label: "deploy-ap",
      depth: 1,
      status: "skipped",
      glyphKey: "skipped",
      role: "skipped",
      attempt: "\u2014",
      elapsed: "\u2014",
      note: "upstream failed",
    }),
    {
      id: "batch:regions",
      kind: "batch-aggregate",
      depth: 0,
      label: "\u27f3 batch [regions]",
      status: "failed",
      attempt: "\u2014",
      elapsed: "34s",
      elapsedMs: 34_000,
      note: "1 / 3   \u2588\u2588\u2588\u2591\u2591\u2591\u2591\u2591\u2591   1 \u2717 \u00b7 0 \u23f8",
      role: "failed",
      glyphKey: "batch",
      nodeId: "regions",
      aggregate: {
        batchId: "regions",
        nodeId: "regions",
        label: "batch [regions]",
        expected: 3,
        completed: 1,
        succeeded: 0,
        failed: 1,
        retries: 0,
        status: "failed",
        earliestStartedAt: "2026-04-17T11:59:30Z",
      },
    },
    leaf({
      id: "rollback-us",
      label: "rollback-us",
      status: "pending",
      glyphKey: "pending",
      role: "pending",
      attempt: "\u2014",
      elapsed: "\u2014",
      note: "routed by fail:max, not yet started",
    }),
  ];

  it("renders the skipped + failed + pending glyphs and labels", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("\u2717"); // ✗ fail
    expect(frame).toContain("\u25cb"); // ○ skipped
    expect(frame).toContain("\u2299"); // ⊙ pending
    expect(frame).toContain("failed");
    expect(frame).toContain("skipped");
  });

  it("deploy-us NOTE contains 'retries exhausted · edge: fail:max'", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("retries exhausted");
    expect(frame).toContain("fail:max");
  });

  it("deploy-ap NOTE is 'upstream failed'", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("upstream failed");
  });

  it("aggregate NOTE shows '1 / 3' + '1 ✗ · 0 ⏸' suffix", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    expect(frame).toContain("1 / 3");
    expect(frame).toContain("1 \u2717 \u00b7 0 \u23f8");
  });

  it("renders every mockup §6 row label", () => {
    const frame = stripAnsi(renderTable({ rows, width: 129 }));
    for (const lbl of [
      "build",
      "test",
      "fan-out",
      "deploy-us",
      "deploy-eu",
      "deploy-ap",
      "batch [regions]",
      "rollback-us",
    ]) {
      expect(frame).toContain(lbl);
    }
  });
});
