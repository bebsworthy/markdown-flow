// test/steps/derive.test.ts
//
// Unit tests for `src/steps/derive.ts` — pure projection helpers that turn
// engine `Token` + `StepResult` records into displayable step-row fields.

import { describe, it, expect } from "vitest";
import type { StepResult, Token } from "markflow";
import {
  deriveStepElapsedMs,
  formatAttempt,
  formatEdgeNote,
  formatStepElapsed,
  formatWaitingNote,
  stepStatusToGlyphKey,
  stepStatusToLabel,
  stepStatusToRole,
  tokenToStatus,
  toStepStatusCell,
} from "../../src/steps/derive.js";

const NOW = Date.parse("2026-04-17T12:00:00Z");

function tok(overrides: Partial<Token> = {}): Token {
  return {
    id: overrides.id ?? "t1",
    nodeId: overrides.nodeId ?? "build",
    generation: overrides.generation ?? 0,
    state: overrides.state ?? "pending",
    edge: overrides.edge,
    result: overrides.result,
    batchId: overrides.batchId,
    itemIndex: overrides.itemIndex,
    parentTokenId: overrides.parentTokenId,
  };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return {
    node: overrides.node ?? "build",
    type: overrides.type ?? "script",
    edge: overrides.edge ?? "success",
    summary: overrides.summary ?? "",
    local: overrides.local,
    started_at: overrides.started_at ?? "2026-04-17T11:59:00Z",
    completed_at: overrides.completed_at ?? "2026-04-17T11:59:30Z",
    exit_code: overrides.exit_code ?? 0,
  };
}

describe("tokenToStatus → stepStatusToRole / GlyphKey / Label", () => {
  it("pending token → pending / pending / 'pending'", () => {
    const s = tokenToStatus(tok({ state: "pending" }));
    expect(s).toBe("pending");
    expect(stepStatusToRole(s)).toBe("pending");
    expect(stepStatusToGlyphKey(s)).toBe("pending");
    expect(stepStatusToLabel(s)).toBe("pending");
  });

  it("running token → running / running / 'running'", () => {
    const s = tokenToStatus(tok({ state: "running" }));
    expect(s).toBe("running");
    expect(stepStatusToRole(s)).toBe("running");
    expect(stepStatusToGlyphKey(s)).toBe("running");
    expect(stepStatusToLabel(s)).toBe("running");
  });

  it("complete + edge='next' → complete / ok / 'ok'", () => {
    const s = tokenToStatus(
      tok({ state: "complete", result: result({ edge: "next" }) }),
    );
    expect(s).toBe("complete");
    expect(stepStatusToRole(s)).toBe("complete");
    expect(stepStatusToGlyphKey(s)).toBe("ok");
    expect(stepStatusToLabel(s)).toBe("ok");
  });

  it("complete + edge='fail' → failed / fail / 'failed'", () => {
    const s = tokenToStatus(
      tok({ state: "complete", result: result({ edge: "fail" }) }),
    );
    expect(s).toBe("failed");
    expect(stepStatusToRole(s)).toBe("failed");
    expect(stepStatusToGlyphKey(s)).toBe("fail");
    expect(stepStatusToLabel(s)).toBe("failed");
  });

  it("complete + edge='fail:max' → failed / fail / 'failed'", () => {
    const s = tokenToStatus(
      tok({ state: "complete", result: result({ edge: "fail:max" }) }),
    );
    expect(s).toBe("failed");
    expect(stepStatusToGlyphKey(s)).toBe("fail");
  });

  it("skipped → skipped / skipped / 'skipped'", () => {
    const s = tokenToStatus(tok({ state: "skipped" }));
    expect(s).toBe("skipped");
    expect(stepStatusToGlyphKey(s)).toBe("skipped");
    expect(stepStatusToLabel(s)).toBe("skipped");
  });

  it("waiting → waiting / waiting / 'waiting'", () => {
    const s = tokenToStatus(tok({ state: "waiting" }));
    expect(s).toBe("waiting");
    expect(stepStatusToRole(s)).toBe("waiting");
    expect(stepStatusToGlyphKey(s)).toBe("waiting");
    expect(stepStatusToLabel(s)).toBe("waiting");
  });

  it("running + hasRetryHint → retrying / retry / 'retrying'", () => {
    const s = tokenToStatus(tok({ state: "running" }), true);
    expect(s).toBe("retrying");
    expect(stepStatusToRole(s)).toBe("retrying");
    expect(stepStatusToGlyphKey(s)).toBe("retry");
    expect(stepStatusToLabel(s)).toBe("retrying");
  });

  it("complete + hasRetryHint does NOT retroactively become retrying", () => {
    const s = tokenToStatus(
      tok({ state: "complete", result: result() }),
      true,
    );
    expect(s).toBe("complete");
  });
});

describe("toStepStatusCell", () => {
  it("returns glyph + label + role for a status", () => {
    const cell = toStepStatusCell("running");
    expect(cell.glyph).toBe("\u25b6");
    expect(cell.label).toBe("running");
    expect(cell.role).toBe("running");
    expect(cell.glyphKey).toBe("running");
  });

  it("returns 'ok' label for complete status", () => {
    const cell = toStepStatusCell("complete");
    expect(cell.label).toBe("ok");
    expect(cell.glyphKey).toBe("ok");
  });
});

describe("formatAttempt", () => {
  it("undefined budget → em-dash", () => {
    expect(formatAttempt(undefined)).toBe("\u2014");
  });

  it("budget { count: 2, max: 2 } → '3/3'", () => {
    // count = retries consumed; current attempt = count + 1; total = max + 1.
    expect(formatAttempt({ count: 2, max: 2 })).toBe("3/3");
  });

  it("budget { count: 0, max: 2 } → '1/3'", () => {
    expect(formatAttempt({ count: 0, max: 2 })).toBe("1/3");
  });

  it("budget { count: 1, max: 2 } → '2/3'", () => {
    expect(formatAttempt({ count: 1, max: 2 })).toBe("2/3");
  });
});

describe("deriveStepElapsedMs / formatStepElapsed", () => {
  it("complete token uses completed - started", () => {
    const t = tok({
      state: "complete",
      result: result({
        started_at: "2026-04-17T11:59:00Z",
        completed_at: "2026-04-17T11:59:14Z",
      }),
    });
    expect(deriveStepElapsedMs(t, NOW)).toBe(14000);
    expect(formatStepElapsed(14000)).toBe("14s");
  });

  it("running token uses now - started", () => {
    const t = tok({
      state: "running",
      result: result({ started_at: "2026-04-17T11:59:00Z" }),
    });
    expect(deriveStepElapsedMs(t, NOW)).toBe(60_000);
    expect(formatStepElapsed(60_000)).toBe("1:00");
  });

  it("pending token returns 0 and formatter returns em-dash", () => {
    const t = tok({ state: "pending" });
    expect(deriveStepElapsedMs(t, NOW)).toBe(0);
    expect(formatStepElapsed(0)).toBe("\u2014");
  });

  it("malformed started_at returns 0 / em-dash", () => {
    const t = tok({
      state: "running",
      result: result({ started_at: "not-a-date" }),
    });
    expect(deriveStepElapsedMs(t, NOW)).toBe(0);
    expect(formatStepElapsed(NaN)).toBe("\u2014");
  });

  it("<60s → 'Ns'", () => {
    expect(formatStepElapsed(1000)).toBe("1s");
    expect(formatStepElapsed(59_000)).toBe("59s");
  });

  it("minutes → 'M:SS'", () => {
    expect(formatStepElapsed(2 * 60_000 + 14_000)).toBe("2:14");
  });

  it("hours → 'HhMm'", () => {
    expect(formatStepElapsed(3_720_000)).toBe("1h2m");
  });
});

describe("formatEdgeNote", () => {
  it("edge='success' → '→ next'", () => {
    expect(formatEdgeNote(result({ edge: "success" }))).toBe("\u2192 next");
  });

  it("edge='' → '→ next'", () => {
    expect(formatEdgeNote(result({ edge: "" }))).toBe("\u2192 next");
  });

  it("edge='fail' renders with exit code", () => {
    expect(
      formatEdgeNote(result({ edge: "fail", exit_code: 1 })),
    ).toBe("edge: fail (exit 1)");
  });

  it("edge='fail:max' renders with exit code", () => {
    expect(
      formatEdgeNote(result({ edge: "fail:max", exit_code: 1 })),
    ).toBe("retries exhausted \u00b7 edge: fail:max (exit 1)");
  });

  it("custom edge routes → '→ <edge>'", () => {
    expect(formatEdgeNote(result({ edge: "rollback" }))).toBe(
      "\u2192 rollback",
    );
  });
});

describe("formatWaitingNote", () => {
  it("no result → 'waiting'", () => {
    expect(formatWaitingNote(undefined)).toBe("waiting");
  });

  it("quotes the summary when present", () => {
    expect(formatWaitingNote(result({ summary: "approve?" }))).toBe(
      '"approve?"',
    );
  });
});
