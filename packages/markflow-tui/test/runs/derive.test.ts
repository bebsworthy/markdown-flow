// test/runs/derive.test.ts
//
// Unit tests for the pure `RunInfo` → `RunsTableRow` projection helpers.

import { describe, it, expect } from "vitest";
import type { RunInfo, StepResult } from "markflow";
import {
  deriveElapsedMs,
  deriveNote,
  deriveStepLabel,
  formatElapsed,
  formatShortId,
  formatStartedHMS,
  runStatusToGlyphKey,
  runStatusToLabel,
  runStatusToRole,
  toRunsTableRow,
  toStatusCell,
} from "../../src/runs/derive.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

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

function info(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "abcd1234xyz",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "./deploy.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

// ---------------------------------------------------------------------------
// runStatusTo* mappers
// ---------------------------------------------------------------------------

describe("runStatusToRole", () => {
  it("running → running, complete → complete, error → failed, suspended → waiting", () => {
    expect(runStatusToRole("running")).toBe("running");
    expect(runStatusToRole("complete")).toBe("complete");
    expect(runStatusToRole("error")).toBe("failed");
    expect(runStatusToRole("suspended")).toBe("waiting");
  });
});

describe("runStatusToGlyphKey", () => {
  it("maps engine statuses to glyph keys", () => {
    expect(runStatusToGlyphKey("running")).toBe("running");
    expect(runStatusToGlyphKey("complete")).toBe("ok");
    expect(runStatusToGlyphKey("error")).toBe("fail");
    expect(runStatusToGlyphKey("suspended")).toBe("waiting");
  });
});

describe("runStatusToLabel", () => {
  it("complete → 'ok' and error → 'failed' per mockups §1", () => {
    expect(runStatusToLabel("running")).toBe("running");
    expect(runStatusToLabel("complete")).toBe("ok");
    expect(runStatusToLabel("error")).toBe("failed");
    expect(runStatusToLabel("suspended")).toBe("waiting");
  });
});

// ---------------------------------------------------------------------------
// formatShortId
// ---------------------------------------------------------------------------

describe("formatShortId", () => {
  it("extracts HH:MM:SS from timestamp-style ids", () => {
    expect(formatShortId("2026-04-19T10-18-20-290Z")).toBe("10:18:20");
  });

  it("falls back to first 8 chars for non-timestamp ids", () => {
    expect(formatShortId("abcdefghij")).toBe("abcdefgh");
  });

  it("passes through short ids unchanged", () => {
    expect(formatShortId("abc")).toBe("abc");
    expect(formatShortId("abcdefgh")).toBe("abcdefgh");
  });
});

// ---------------------------------------------------------------------------
// formatStartedHMS
// ---------------------------------------------------------------------------

describe("formatStartedHMS", () => {
  it("formats an ISO timestamp as HH:MM:SS in local time", () => {
    // Use a fixed ISO and pick the expected string from the same Date we
    // expect the implementation to use — avoids timezone flake.
    const iso = "2026-04-17T11:55:00Z";
    const d = new Date(Date.parse(iso));
    const expected = [
      d.getHours().toString().padStart(2, "0"),
      d.getMinutes().toString().padStart(2, "0"),
      d.getSeconds().toString().padStart(2, "0"),
    ].join(":");
    expect(formatStartedHMS(iso)).toBe(expected);
  });

  it("returns em-dash for malformed ISO", () => {
    expect(formatStartedHMS("not-a-date")).toBe("—");
    expect(formatStartedHMS("")).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// formatElapsed
// ---------------------------------------------------------------------------

describe("formatElapsed", () => {
  it("< 60s → 'Ns'", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  it("< 1h → 'NmSSs'", () => {
    expect(formatElapsed(60_000)).toBe("1m00s");
    expect(formatElapsed(75_000)).toBe("1m15s");
    expect(formatElapsed(3_599_000)).toBe("59m59s");
  });

  it("< 24h → 'NhMm'", () => {
    expect(formatElapsed(3_600_000)).toBe("1h00m");
    expect(formatElapsed(3_660_000)).toBe("1h01m");
    expect(formatElapsed(7_260_000)).toBe("2h01m");
  });

  it(">= 24h → 'Nd Hh'", () => {
    expect(formatElapsed(86_400_000)).toBe("1d 0h");
    expect(formatElapsed(90_000_000)).toBe("1d 1h");
    expect(formatElapsed(172_800_000 + 7_200_000)).toBe("2d 2h");
  });

  it("negative / NaN → em-dash", () => {
    expect(formatElapsed(-1)).toBe("—");
    expect(formatElapsed(Number.NaN)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// deriveElapsedMs
// ---------------------------------------------------------------------------

describe("deriveElapsedMs", () => {
  it("uses completedAt for terminal runs", () => {
    const r = info({
      status: "complete",
      startedAt: "2026-04-17T11:55:00Z",
      completedAt: "2026-04-17T11:56:00Z",
    });
    expect(deriveElapsedMs(r, NOW)).toBe(60_000);
  });

  it("uses now for active runs with no completedAt", () => {
    const r = info({
      status: "running",
      startedAt: "2026-04-17T11:55:00Z",
    });
    expect(deriveElapsedMs(r, NOW)).toBe(5 * 60_000);
  });

  it("returns 0 for malformed startedAt", () => {
    const r = info({ startedAt: "not-a-date" });
    expect(deriveElapsedMs(r, NOW)).toBe(0);
  });

  it("clamps negative differences to 0", () => {
    const r = info({
      startedAt: "2026-04-17T13:00:00Z", // after NOW
    });
    expect(deriveElapsedMs(r, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveStepLabel
// ---------------------------------------------------------------------------

describe("deriveStepLabel", () => {
  it("returns em-dash for an empty step list", () => {
    expect(deriveStepLabel(info({ steps: [] }))).toBe("—");
  });

  it("returns the last step's node name when not a batch", () => {
    expect(
      deriveStepLabel(info({ steps: [step({ node: "build" })] })),
    ).toBe("build");
  });

  it("renders batch progression as 'node M/N' when the last node matches node#N", () => {
    const steps = [
      step({ node: "scan#0" }),
      step({ node: "scan#1" }),
      step({ node: "scan#2" }),
    ];
    // 3 trailing items with base 'scan', last index 2 → total max(3, 3) = 3.
    expect(deriveStepLabel(info({ steps }))).toBe("scan 3/3");
  });

  it("non-batch final step is returned verbatim even if earlier steps matched #N", () => {
    const steps = [step({ node: "scan#0" }), step({ node: "finalize" })];
    expect(deriveStepLabel(info({ steps }))).toBe("finalize");
  });
});

// ---------------------------------------------------------------------------
// deriveNote
// ---------------------------------------------------------------------------

describe("deriveNote", () => {
  it("error + summary → summary verbatim", () => {
    const r = info({
      status: "error",
      steps: [step({ summary: "connection refused" })],
    });
    expect(deriveNote(r)).toBe("connection refused");
  });

  it("error without summary and non-zero exit → 'exit N · retries exhausted'", () => {
    const r = info({
      status: "error",
      steps: [step({ summary: "", exit_code: 2 })],
    });
    expect(deriveNote(r)).toBe("exit 2 · retries exhausted");
  });

  it("suspended with summary → quoted prompt", () => {
    const r = info({
      status: "suspended",
      steps: [step({ summary: "deploy to prod?" })],
    });
    expect(deriveNote(r)).toBe('"deploy to prod?"');
  });

  it("suspended without summary → 'waiting'", () => {
    const r = info({
      status: "suspended",
      steps: [step({ summary: "" })],
    });
    expect(deriveNote(r)).toBe("waiting");
  });

  it("running with non-zero exit on last step → retry glyph + 'retrying'", () => {
    const r = info({
      status: "running",
      steps: [step({ exit_code: 1 })],
    });
    expect(deriveNote(r)).toMatch(/retrying$/);
  });

  it("running cleanly (exit 0) → empty string", () => {
    const r = info({ status: "running", steps: [step({ exit_code: 0 })] });
    expect(deriveNote(r)).toBe("");
  });

  it("complete → empty string", () => {
    const r = info({ status: "complete", steps: [step({ exit_code: 0 })] });
    expect(deriveNote(r)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toStatusCell / toRunsTableRow
// ---------------------------------------------------------------------------

describe("toStatusCell", () => {
  it("carries glyph + glyphKey + label + role", () => {
    const cell = toStatusCell("running");
    expect(cell.label).toBe("running");
    expect(cell.role).toBe("running");
    expect(cell.glyphKey).toBe("running");
    expect(typeof cell.glyph).toBe("string");
    expect(cell.glyph.length).toBeGreaterThan(0);
  });

  it("error → role='failed', label='failed'", () => {
    const cell = toStatusCell("error");
    expect(cell.role).toBe("failed");
    expect(cell.label).toBe("failed");
    expect(cell.glyphKey).toBe("fail");
  });

  it("complete → role='complete', label='ok'", () => {
    const cell = toStatusCell("complete");
    expect(cell.role).toBe("complete");
    expect(cell.label).toBe("ok");
    expect(cell.glyphKey).toBe("ok");
  });

  it("suspended → role='waiting', label='waiting'", () => {
    const cell = toStatusCell("suspended");
    expect(cell.role).toBe("waiting");
    expect(cell.label).toBe("waiting");
    expect(cell.glyphKey).toBe("waiting");
  });
});

describe("toRunsTableRow", () => {
  it("projects all fields deterministically", () => {
    const r = toRunsTableRow(
      info({
        id: "abcdef1234",
        workflowName: "deploy",
        status: "running",
        startedAt: "2026-04-17T11:55:00Z",
        steps: [step({ node: "build", exit_code: 0 })],
      }),
      NOW,
    );
    expect(r.id).toBe("abcdef1234");
    expect(r.idShort).toBe("abcdef12");
    expect(r.workflow).toBe("deploy");
    expect(r.statusCell.role).toBe("running");
    expect(r.statusLabel.endsWith("running")).toBe(true);
    expect(r.step).toBe("build");
    expect(r.elapsedMs).toBe(5 * 60_000);
    expect(r.elapsed).toBe("5m00s");
    expect(r.ageMs).toBe(5 * 60_000);
    expect(r.age).toBe("5m00s");
    expect(r.note).toBe("");
    expect(r.info.id).toBe("abcdef1234");
  });

  it("projects a terminal (error) row's note from the last step summary", () => {
    const r = toRunsTableRow(
      info({
        status: "error",
        completedAt: "2026-04-17T11:59:00Z",
        steps: [step({ summary: "boom", exit_code: 1 })],
      }),
      NOW,
    );
    expect(r.statusCell.role).toBe("failed");
    expect(r.note).toBe("boom");
  });
});
