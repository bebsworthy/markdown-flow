// test/runs/filter.test.ts
//
// Parser + predicate tests for the runs-mode filter pipeline (P5-T2 §10.2).
// Mirrors the grammar documented in docs/tui/plans/P5-T2.md §3.

import { describe, it, expect } from "vitest";
import type { RunInfo, StepResult } from "markflow";
import {
  applyFilter,
  parseFilterInput,
} from "../../src/runs/filter.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type { RunsTableRow } from "../../src/runs/types.js";

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
// Parser
// ---------------------------------------------------------------------------

describe("parseFilterInput — empty + status", () => {
  it("empty string yields no terms", () => {
    const parsed = parseFilterInput("");
    expect(parsed.raw).toBe("");
    expect(parsed.terms).toEqual([]);
  });

  it("whitespace-only yields no terms", () => {
    const parsed = parseFilterInput("   \t  ");
    expect(parsed.terms).toEqual([]);
  });

  it("parses `status:running`", () => {
    const parsed = parseFilterInput("status:running");
    expect(parsed.terms).toEqual([{ kind: "status", value: "running" }]);
  });

  it("alias `status:ok` → complete", () => {
    const parsed = parseFilterInput("status:ok");
    expect(parsed.terms).toEqual([{ kind: "status", value: "complete" }]);
  });

  it("alias `status:failed` → error", () => {
    const parsed = parseFilterInput("status:failed");
    expect(parsed.terms).toEqual([{ kind: "status", value: "error" }]);
  });

  it("unknown status value → malformed", () => {
    const parsed = parseFilterInput("status:nope");
    expect(parsed.terms).toEqual([{ kind: "malformed", raw: "status:nope" }]);
  });

  it("case-insensitive prefix (`Status:Running`)", () => {
    const parsed = parseFilterInput("Status:Running");
    expect(parsed.terms).toEqual([{ kind: "status", value: "running" }]);
  });
});

describe("parseFilterInput — workflow", () => {
  it("parses `workflow:deploy` (lowercased tail)", () => {
    const parsed = parseFilterInput("workflow:deploy");
    expect(parsed.terms).toEqual([{ kind: "workflow", value: "deploy" }]);
  });

  it("`workflow:` with empty tail → malformed", () => {
    const parsed = parseFilterInput("workflow:");
    expect(parsed.terms).toEqual([{ kind: "malformed", raw: "workflow:" }]);
  });

  it('quoted tail preserves embedded spaces (`workflow:"multi region"`)', () => {
    const parsed = parseFilterInput('workflow:"multi region"');
    expect(parsed.terms).toEqual([
      { kind: "workflow", value: "multi region" },
    ]);
  });

  it("case-insensitive tail (`workflow:DEPLOY` stored lowercased)", () => {
    const parsed = parseFilterInput("workflow:DEPLOY");
    expect(parsed.terms).toEqual([{ kind: "workflow", value: "deploy" }]);
  });
});

describe("parseFilterInput — since", () => {
  it("parses `since:30s`", () => {
    const parsed = parseFilterInput("since:30s");
    expect(parsed.terms).toEqual([{ kind: "since", durationMs: 30_000 }]);
  });

  it("parses `since:1h30m`", () => {
    const parsed = parseFilterInput("since:1h30m");
    expect(parsed.terms).toEqual([{ kind: "since", durationMs: 5_400_000 }]);
  });

  it("`since:garbage` → malformed", () => {
    const parsed = parseFilterInput("since:garbage");
    expect(parsed.terms).toEqual([
      { kind: "malformed", raw: "since:garbage" },
    ]);
  });
});

describe("parseFilterInput — id-prefix + fallthrough", () => {
  it("free-text atom becomes idPrefix", () => {
    const parsed = parseFilterInput("abc");
    expect(parsed.terms).toEqual([{ kind: "idPrefix", value: "abc" }]);
  });

  it("`status::running` (double colon) falls through to idPrefix", () => {
    const parsed = parseFilterInput("status::running");
    expect(parsed.terms).toEqual([
      { kind: "idPrefix", value: "status::running" },
    ]);
  });
});

describe("parseFilterInput — multi-term", () => {
  it("`status:running workflow:deploy` yields two valid terms", () => {
    const parsed = parseFilterInput("status:running workflow:deploy");
    expect(parsed.terms).toEqual([
      { kind: "status", value: "running" },
      { kind: "workflow", value: "deploy" },
    ]);
  });

  it("extra whitespace between terms collapsed", () => {
    const parsed = parseFilterInput("status:running   workflow:deploy");
    expect(parsed.terms).toEqual([
      { kind: "status", value: "running" },
      { kind: "workflow", value: "deploy" },
    ]);
  });

  it("tab-separated atoms", () => {
    const parsed = parseFilterInput("status:running\tworkflow:deploy");
    expect(parsed.terms).toEqual([
      { kind: "status", value: "running" },
      { kind: "workflow", value: "deploy" },
    ]);
  });

  it("trailing whitespace ignored", () => {
    const parsed = parseFilterInput("  status:running  ");
    expect(parsed.terms).toEqual([{ kind: "status", value: "running" }]);
  });

  it("malformed + valid terms retained in original order", () => {
    const parsed = parseFilterInput("status:running status:nope workflow:deploy");
    expect(parsed.terms).toEqual([
      { kind: "status", value: "running" },
      { kind: "malformed", raw: "status:nope" },
      { kind: "workflow", value: "deploy" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Predicate — applyFilter
// ---------------------------------------------------------------------------

describe("applyFilter — identity + basics", () => {
  it("empty filter = identity (returns all rows)", () => {
    const rows = [
      row({ id: "a1", status: "running" }),
      row({ id: "a2", status: "complete", completedAt: "2026-04-17T11:58:00Z" }),
    ];
    const filter = parseFilterInput("");
    expect(applyFilter(rows, filter, NOW)).toHaveLength(2);
  });

  it("status:running keeps only running rows", () => {
    const rows = [
      row({ id: "a1", status: "running" }),
      row({ id: "a2", status: "complete", completedAt: "2026-04-17T11:58:00Z" }),
      row({ id: "a3", status: "running" }),
    ];
    const filter = parseFilterInput("status:running");
    expect(applyFilter(rows, filter, NOW).map((r) => r.id)).toEqual([
      "a1",
      "a3",
    ]);
  });

  it("workflow:deploy case-insensitive", () => {
    const rows = [
      row({ id: "a1", workflowName: "deploy-prod" }),
      row({ id: "a2", workflowName: "MY-DEPLOY-STG" }),
      row({ id: "a3", workflowName: "release" }),
    ];
    const filter = parseFilterInput("workflow:DEPLOY");
    expect(applyFilter(rows, filter, NOW).map((r) => r.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("idPrefix matches prefix, not substring", () => {
    const rows = [
      row({ id: "abcd1234" }),
      row({ id: "xabcd1234" }),
      row({ id: "abce5678" }),
    ];
    const filter = parseFilterInput("abc");
    expect(applyFilter(rows, filter, NOW).map((r) => r.id)).toEqual([
      "abcd1234",
      "abce5678",
    ]);
  });

  it("since:1h excludes rows started > 1h ago", () => {
    // NOW - 30m
    const startedRecent = new Date(NOW - 30 * 60_000).toISOString();
    // NOW - 2h
    const startedOld = new Date(NOW - 2 * 3_600_000).toISOString();
    const rows = [
      row({ id: "a1", startedAt: startedRecent }),
      row({ id: "a2", startedAt: startedOld }),
    ];
    const filter = parseFilterInput("since:1h");
    expect(applyFilter(rows, filter, NOW).map((r) => r.id)).toEqual(["a1"]);
  });

  it("multi-term AND-combines (status + workflow)", () => {
    const rows = [
      row({ id: "a1", status: "running", workflowName: "deploy-prod" }),
      row({ id: "a2", status: "running", workflowName: "release" }),
      row({ id: "a3", status: "complete", workflowName: "deploy-stg",
            completedAt: "2026-04-17T11:58:00Z" }),
    ];
    const filter = parseFilterInput("status:running workflow:deploy");
    expect(applyFilter(rows, filter, NOW).map((r) => r.id)).toEqual(["a1"]);
  });

  it("malformed terms are ignored by predicate", () => {
    const rows = [
      row({ id: "a1", status: "running" }),
      row({ id: "a2", status: "complete", completedAt: "2026-04-17T11:58:00Z" }),
    ];
    const filter = parseFilterInput("status:nope");
    // Only a malformed term → identity filter.
    expect(applyFilter(rows, filter, NOW)).toHaveLength(2);
  });

  it("returns a fresh array (does not mutate input)", () => {
    const rows = [row({ id: "a1" })];
    const filter = parseFilterInput("");
    const out = applyFilter(rows, filter, NOW);
    expect(out).not.toBe(rows);
  });
});
