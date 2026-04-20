// test/runs/archive.test.ts
//
// Archive predicate + partition tests (P5-T2 §10.3). Behaviour per plan §4.

import { describe, it, expect } from "vitest";
import type { RunInfo, StepResult } from "markflow-cli";
import { applyArchive, isArchived } from "../../src/runs/filter.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import {
  RUNS_ARCHIVE_DEFAULTS,
  type RunsArchivePolicy,
  type RunsTableRow,
} from "../../src/runs/types.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

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
    id: overrides.id ?? "abcd1234",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "./deploy.md",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [step()],
  };
}

function row(overrides: Partial<RunInfo> = {}): RunsTableRow {
  return toRunsTableRow(info(overrides), NOW);
}

// ---------------------------------------------------------------------------
// isArchived — status gating
// ---------------------------------------------------------------------------

describe("isArchived — running/suspended are never archived", () => {
  it("running is never archived regardless of completedAt", () => {
    const row = info({
      status: "running",
      completedAt: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });

  it("suspended is never archived", () => {
    const row = info({
      status: "suspended",
      completedAt: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isArchived — threshold boundaries
// ---------------------------------------------------------------------------

describe("isArchived — complete (24h threshold)", () => {
  it("complete at now - 23h is not archived", () => {
    const row = info({
      status: "complete",
      completedAt: new Date(NOW - 23 * 60 * 60_000).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });

  it("complete at exactly 24h is not archived (strict >)", () => {
    const row = info({
      status: "complete",
      completedAt: new Date(NOW - ONE_DAY_MS).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });

  it("complete at 24h + 1ms is archived", () => {
    const row = info({
      status: "complete",
      completedAt: new Date(NOW - ONE_DAY_MS - 1).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(true);
  });

  it("complete without completedAt is not archived (defensive)", () => {
    const row = info({ status: "complete", completedAt: undefined });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });
});

describe("isArchived — error (7d threshold)", () => {
  it("error at now - 7d exactly is not archived", () => {
    const row = info({
      status: "error",
      completedAt: new Date(NOW - ONE_WEEK_MS).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(false);
  });

  it("error at 7d + 1ms is archived", () => {
    const row = info({
      status: "error",
      completedAt: new Date(NOW - ONE_WEEK_MS - 1).toISOString(),
    });
    expect(isArchived(row, RUNS_ARCHIVE_DEFAULTS, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyArchive — partition semantics
// ---------------------------------------------------------------------------

describe("applyArchive — partition", () => {
  it("shown=false hides archived rows; shown+archived = rows", () => {
    const rows: ReadonlyArray<RunsTableRow> = [
      row({ id: "r1", status: "running" }),
      row({
        id: "r2",
        status: "complete",
        completedAt: new Date(NOW - ONE_DAY_MS - 10).toISOString(),
      }),
      row({
        id: "r3",
        status: "complete",
        completedAt: new Date(NOW - 60_000).toISOString(),
      }),
    ];
    const { shown, archived } = applyArchive(rows, RUNS_ARCHIVE_DEFAULTS, NOW);
    expect(shown.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(archived.map((r) => r.id)).toEqual(["r2"]);
    expect(shown.length + archived.length).toBe(rows.length);
  });

  it("shown=true returns all rows in shown; archived list still populated", () => {
    const policy: RunsArchivePolicy = { ...RUNS_ARCHIVE_DEFAULTS, shown: true };
    const rows: ReadonlyArray<RunsTableRow> = [
      row({
        id: "r1",
        status: "complete",
        completedAt: new Date(NOW - ONE_DAY_MS - 10).toISOString(),
      }),
      row({ id: "r2", status: "running" }),
    ];
    const { shown, archived } = applyArchive(rows, policy, NOW);
    expect(shown.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(archived.map((r) => r.id)).toEqual(["r1"]);
  });

  it("custom thresholds honoured", () => {
    const policy: RunsArchivePolicy = {
      shown: false,
      completeMaxAgeMs: 60_000, // 1 minute
      errorMaxAgeMs: 60_000,
    };
    const rows: ReadonlyArray<RunsTableRow> = [
      row({
        id: "fresh",
        status: "complete",
        completedAt: new Date(NOW - 30_000).toISOString(),
      }),
      row({
        id: "stale",
        status: "complete",
        completedAt: new Date(NOW - 120_000).toISOString(),
      }),
    ];
    const { shown, archived } = applyArchive(rows, policy, NOW);
    expect(shown.map((r) => r.id)).toEqual(["fresh"]);
    expect(archived.map((r) => r.id)).toEqual(["stale"]);
  });
});

// ---------------------------------------------------------------------------
// Defaults — sanity checks on the exported constant
// ---------------------------------------------------------------------------

describe("RUNS_ARCHIVE_DEFAULTS", () => {
  it("completeMaxAgeMs === 86_400_000", () => {
    expect(RUNS_ARCHIVE_DEFAULTS.completeMaxAgeMs).toBe(86_400_000);
  });

  it("errorMaxAgeMs === 604_800_000", () => {
    expect(RUNS_ARCHIVE_DEFAULTS.errorMaxAgeMs).toBe(604_800_000);
  });

  it("default shown=false", () => {
    expect(RUNS_ARCHIVE_DEFAULTS.shown).toBe(false);
  });
});
