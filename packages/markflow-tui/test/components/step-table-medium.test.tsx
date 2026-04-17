// test/components/step-table-medium.test.tsx
//
// P8-T1 §4.2 acceptance anchor for <StepTable> at width=90: header set is
// STEP · STATUS · ELAPSED · NOTE (no ATTEMPT) and a retrying row's NOTE
// surfaces the "attempt 2/3" text (attempt folded via note).

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { StepTable } from "../../src/components/step-table.js";
import {
  STEP_COLUMNS_MEDIUM,
  pickStepColumnSet,
} from "../../src/steps/columns.js";
import type { StepRow } from "../../src/steps/types.js";

const COLOR_OFF = buildTheme({ color: false, unicode: true });
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const NOW = Date.parse("2026-04-17T12:00:00Z");

function leaf(r: Partial<StepRow> & { id: string }): StepRow {
  return {
    id: r.id,
    kind: "leaf",
    depth: r.depth ?? 0,
    label: r.label ?? r.id,
    status: r.status ?? "pending",
    attempt: r.attempt ?? "\u2014",
    elapsed: r.elapsed ?? "\u2014",
    elapsedMs: r.elapsedMs ?? 0,
    note: r.note ?? "",
    role: r.role ?? "pending",
    glyphKey: r.glyphKey ?? "pending",
    tokenId: r.id,
    nodeId: r.nodeId ?? r.id,
  };
}

function renderAt90(rows: ReadonlyArray<StepRow>): {
  readonly frame: string;
  readonly cleanup: () => void;
} {
  const r = render(
    <ThemeProvider value={COLOR_OFF}>
      <StepTable
        rows={rows}
        columns={pickStepColumnSet(90)}
        width={90}
        height={10}
        nowMs={NOW}
        selectedStepId={null}
      />
    </ThemeProvider>,
  );
  return {
    frame: stripAnsi(r.lastFrame() ?? ""),
    cleanup: () => r.unmount(),
  };
}

describe("<StepTable> medium tier (width=90)", () => {
  it("uses STEP_COLUMNS_MEDIUM (no ATTEMPT)", () => {
    expect(pickStepColumnSet(90)).toBe(STEP_COLUMNS_MEDIUM);
    expect(STEP_COLUMNS_MEDIUM.find((c) => c.id === "attempt")).toBeUndefined();
  });

  it("header line contains STEP, STATUS, ELAPSED, NOTE (in order) and no ATTEMPT", () => {
    const rows: ReadonlyArray<StepRow> = [
      leaf({ id: "build", label: "build", status: "running" }),
      leaf({ id: "deploy-us", label: "deploy-us", status: "retrying" }),
    ];
    const { frame, cleanup } = renderAt90(rows);
    const headerLine = frame.split("\n").find((l) => l.includes("STEP")) ?? "";
    expect(headerLine).toContain("STEP");
    expect(headerLine).toContain("STATUS");
    expect(headerLine).toContain("ELAPSED");
    expect(headerLine).toContain("NOTE");
    expect(headerLine).not.toContain("ATTEMPT");
    const stepIdx = headerLine.indexOf("STEP");
    const statusIdx = headerLine.indexOf("STATUS");
    const elapsedIdx = headerLine.indexOf("ELAPSED");
    const noteIdx = headerLine.indexOf("NOTE");
    expect(stepIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(elapsedIdx);
    expect(elapsedIdx).toBeLessThan(noteIdx);
    cleanup();
  });

  it("attempt fold: the deploy-us row NOTE contains 'attempt 2/3' at medium tier", () => {
    const rows: ReadonlyArray<StepRow> = [
      leaf({
        id: "deploy-us",
        label: "deploy-us",
        status: "retrying",
        attempt: "2/3",
        elapsed: "12s",
        elapsedMs: 12_000,
        note: "\u21bb retrying \u00b7 attempt 2/3",
        role: "running",
        glyphKey: "retry",
      }),
    ];
    const { frame, cleanup } = renderAt90(rows);
    expect(frame).toContain("attempt 2/3");
    cleanup();
  });
});
