// test/runs/sort.test.ts
//
// Unit tests for the pure sort primitives (P5-T1).

import { describe, it, expect } from "vitest";
import type { RunInfo, RunStatus } from "markflow";
import {
  SORT_KEY_ORDER,
  attentionBucket,
  attentionCompare,
  compareByKey,
  cycleSortKey,
  sortRows,
} from "../../src/runs/sort.js";
import { toRunsTableRow } from "../../src/runs/derive.js";
import type {
  RunsSortState,
  RunsTableRow,
  SortKey,
} from "../../src/runs/types.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");

function makeInfo(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: overrides.id ?? "r000000",
    workflowName: overrides.workflowName ?? "deploy",
    sourceFile: overrides.sourceFile ?? "./deploy.md",
    status: (overrides.status ?? "running") as RunStatus,
    startedAt: overrides.startedAt ?? "2026-04-17T11:55:00Z",
    completedAt: overrides.completedAt,
    steps: overrides.steps ?? [],
  };
}

function makeRow(overrides: Partial<RunInfo> = {}): RunsTableRow {
  return toRunsTableRow(makeInfo(overrides), NOW);
}

describe("attentionCompare", () => {
  it("active bucket sorts before terminal", () => {
    const a = makeRow({ id: "a", status: "running" });
    const b = makeRow({
      id: "b",
      status: "complete",
      completedAt: "2026-04-17T11:59:59Z",
    });
    expect(attentionCompare(a, b)).toBeLessThan(0);
    expect(attentionCompare(b, a)).toBeGreaterThan(0);
  });

  it("within active: newer startedAt first", () => {
    const older = makeRow({
      id: "older",
      status: "running",
      startedAt: "2026-04-17T11:00:00Z",
    });
    const newer = makeRow({
      id: "newer",
      status: "running",
      startedAt: "2026-04-17T11:30:00Z",
    });
    expect(attentionCompare(newer, older)).toBeLessThan(0);
    expect(attentionCompare(older, newer)).toBeGreaterThan(0);
  });

  it("within terminal: newer completedAt first", () => {
    const older = makeRow({
      id: "older",
      status: "complete",
      startedAt: "2026-04-17T10:00:00Z",
      completedAt: "2026-04-17T10:10:00Z",
    });
    const newer = makeRow({
      id: "newer",
      status: "complete",
      startedAt: "2026-04-17T11:00:00Z",
      completedAt: "2026-04-17T11:30:00Z",
    });
    expect(attentionCompare(newer, older)).toBeLessThan(0);
  });

  it("within terminal with no completedAt, falls back to startedAt", () => {
    const a = makeRow({
      id: "a",
      status: "error",
      startedAt: "2026-04-17T11:00:00Z",
    });
    const b = makeRow({
      id: "b",
      status: "error",
      startedAt: "2026-04-17T11:30:00Z",
    });
    expect(attentionCompare(b, a)).toBeLessThan(0);
  });

  it("ties break by id asc (stable)", () => {
    const a = makeRow({
      id: "aaa",
      status: "running",
      startedAt: "2026-04-17T11:00:00Z",
    });
    const b = makeRow({
      id: "bbb",
      status: "running",
      startedAt: "2026-04-17T11:00:00Z",
    });
    expect(attentionCompare(a, b)).toBeLessThan(0);
    expect(attentionCompare(b, a)).toBeGreaterThan(0);
  });

  it("status 'running' and 'suspended' both map to active bucket", () => {
    expect(attentionBucket(makeInfo({ status: "running" }))).toBe("active");
    expect(attentionBucket(makeInfo({ status: "suspended" }))).toBe("active");
  });

  it("status 'complete' and 'error' both map to terminal bucket", () => {
    expect(attentionBucket(makeInfo({ status: "complete" }))).toBe("terminal");
    expect(attentionBucket(makeInfo({ status: "error" }))).toBe("terminal");
  });
});

describe("compareByKey — non-attention keys", () => {
  it("'started': newest first, ties by id asc", () => {
    const a = makeRow({
      id: "b",
      startedAt: "2026-04-17T11:00:00Z",
    });
    const b = makeRow({
      id: "a",
      startedAt: "2026-04-17T11:30:00Z",
    });
    expect(compareByKey(b, a, "started")).toBeLessThan(0);
    const c = makeRow({ id: "aaa", startedAt: "2026-04-17T11:00:00Z" });
    const d = makeRow({ id: "bbb", startedAt: "2026-04-17T11:00:00Z" });
    expect(compareByKey(c, d, "started")).toBeLessThan(0);
  });

  it("'ended': most-recently-finished first; terminal rows use completedAt", () => {
    const older = makeRow({
      id: "older",
      status: "complete",
      completedAt: "2026-04-17T11:00:00Z",
    });
    const newer = makeRow({
      id: "newer",
      status: "complete",
      completedAt: "2026-04-17T11:30:00Z",
    });
    expect(compareByKey(newer, older, "ended")).toBeLessThan(0);
  });

  it("'elapsed': longest run first (requires nowMs threaded through)", () => {
    const shortRun = makeRow({
      id: "short",
      status: "running",
      startedAt: "2026-04-17T11:55:00Z",
    });
    const longRun = makeRow({
      id: "long",
      status: "running",
      startedAt: "2026-04-17T10:00:00Z",
    });
    expect(compareByKey(longRun, shortRun, "elapsed")).toBeLessThan(0);
  });

  it("'status': running < suspended < error < complete", () => {
    const run = makeRow({ id: "r1", status: "running" });
    const sus = makeRow({ id: "r2", status: "suspended" });
    const err = makeRow({ id: "r3", status: "error" });
    const ok = makeRow({ id: "r4", status: "complete" });
    expect(compareByKey(run, sus, "status")).toBeLessThan(0);
    expect(compareByKey(sus, err, "status")).toBeLessThan(0);
    expect(compareByKey(err, ok, "status")).toBeLessThan(0);
  });

  it("'workflow': case-fold alphabetical", () => {
    const alpha = makeRow({ id: "a", workflowName: "Alpha" });
    const beta = makeRow({ id: "b", workflowName: "beta" });
    expect(compareByKey(alpha, beta, "workflow")).toBeLessThan(0);
  });

  it("'id': ascii asc", () => {
    const a = makeRow({ id: "aaa" });
    const b = makeRow({ id: "bbb" });
    expect(compareByKey(a, b, "id")).toBeLessThan(0);
    expect(compareByKey(b, a, "id")).toBeGreaterThan(0);
    expect(compareByKey(a, a, "id")).toBe(0);
  });
});

describe("cycleSortKey", () => {
  it("cycles through the 7 keys in documented order", () => {
    let key: SortKey = "attention";
    const seen: SortKey[] = [key];
    for (let i = 0; i < 7; i++) {
      key = cycleSortKey(key);
      seen.push(key);
    }
    expect(seen.slice(0, 7)).toEqual([...SORT_KEY_ORDER]);
  });

  it("wraps from 'id' back to 'attention'", () => {
    expect(cycleSortKey("id")).toBe("attention");
  });

  it("unknown key defaults to 'attention'", () => {
    // Defensive branch — callers should never hit this, but totality matters.
    expect(cycleSortKey("bogus" as SortKey)).toBe("attention");
  });
});

describe("sortRows", () => {
  const ATTN: RunsSortState = { key: "attention", direction: "desc" };

  it("empty input → empty output", () => {
    expect(sortRows([], ATTN)).toEqual([]);
  });

  it("is stable — equal-sorting rows preserve input order", () => {
    // Two rows with identical keys; stable sort keeps input order.
    const a = makeRow({
      id: "a",
      status: "complete",
      completedAt: "2026-04-17T11:00:00Z",
    });
    const b = makeRow({
      id: "a", // intentional same id to force full-key tie
      status: "complete",
      completedAt: "2026-04-17T11:00:00Z",
    });
    const out = sortRows([a, b], ATTN);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});
