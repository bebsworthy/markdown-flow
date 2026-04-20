// test/steps/retry.test.ts
//
// Unit tests for `src/steps/retry.ts` — RetryHintMap folding + retry-countdown
// formatter. Plan §6 is the authoritative reference for the data flow.

import { describe, it, expect } from "vitest";
import type { EngineEvent } from "markflow-cli";
import {
  applyRetryEvent,
  buildRetryHints,
  EMPTY_RETRY_HINTS,
  formatRetryCountdown,
} from "../../src/steps/retry.js";
import type { RetryHint } from "../../src/steps/types.js";

const SCHEDULED_TS = "2026-04-17T12:00:00.000Z";
const SCHEDULED_MS = Date.parse(SCHEDULED_TS);

function retryEvent(
  overrides: Partial<Extract<EngineEvent, { type: "step:retry" }>> = {},
): EngineEvent {
  return {
    seq: overrides.seq ?? 1,
    ts: overrides.ts ?? SCHEDULED_TS,
    type: "step:retry",
    nodeId: overrides.nodeId ?? "build",
    tokenId: overrides.tokenId ?? "t1",
    attempt: overrides.attempt ?? 2,
    delayMs: overrides.delayMs ?? 5000,
    reason: overrides.reason ?? "fail",
  } as EngineEvent;
}

function startEvent(tokenId: string): EngineEvent {
  return {
    seq: 2,
    ts: "2026-04-17T12:00:01Z",
    type: "step:start",
    nodeId: "build",
    tokenId,
  } as EngineEvent;
}

function completeEvent(tokenId: string): EngineEvent {
  return {
    seq: 3,
    ts: "2026-04-17T12:00:02Z",
    type: "step:complete",
    nodeId: "build",
    tokenId,
    result: {
      node: "build",
      type: "script",
      edge: "success",
      summary: "",
      started_at: "2026-04-17T12:00:01Z",
      completed_at: "2026-04-17T12:00:02Z",
      exit_code: 0,
    },
  } as EngineEvent;
}

describe("applyRetryEvent", () => {
  it("step:retry → inserts a RetryHint keyed by tokenId", () => {
    const next = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent());
    expect(next.size).toBe(1);
    const hint = next.get("t1")!;
    expect(hint.tokenId).toBe("t1");
    expect(hint.nodeId).toBe("build");
    expect(hint.attempt).toBe(2);
    expect(hint.scheduledAtMs).toBe(SCHEDULED_MS);
    expect(hint.delayMs).toBe(5000);
    expect(hint.reason).toBe("fail");
  });

  it("step:retry with existing hint → overwrites", () => {
    const first = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent({ delayMs: 1000 }));
    const second = applyRetryEvent(first, retryEvent({ delayMs: 8000, attempt: 3 }));
    expect(second.size).toBe(1);
    expect(second.get("t1")!.delayMs).toBe(8000);
    expect(second.get("t1")!.attempt).toBe(3);
  });

  it("step:start → deletes the hint for that tokenId", () => {
    const withHint = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent());
    const after = applyRetryEvent(withHint, startEvent("t1"));
    expect(after.size).toBe(0);
  });

  it("step:complete → deletes the hint for that tokenId", () => {
    const withHint = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent());
    const after = applyRetryEvent(withHint, completeEvent("t1"));
    expect(after.size).toBe(0);
  });

  it("step:start for an unrelated tokenId → returns same reference", () => {
    const withHint = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent());
    const after = applyRetryEvent(withHint, startEvent("other"));
    expect(after).toBe(withHint);
  });

  it("step:complete for an unrelated tokenId → returns same reference", () => {
    const withHint = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent());
    const after = applyRetryEvent(withHint, completeEvent("other"));
    expect(after).toBe(withHint);
  });

  it("unrelated event type → returns same reference", () => {
    const ev: EngineEvent = {
      seq: 99,
      ts: SCHEDULED_TS,
      type: "token:state",
      tokenId: "t1",
      from: "pending",
      to: "running",
    } as EngineEvent;
    const same = applyRetryEvent(EMPTY_RETRY_HINTS, ev);
    expect(same).toBe(EMPTY_RETRY_HINTS);
  });

  it("multiple distinct tokenIds → coexist in the map", () => {
    const a = applyRetryEvent(EMPTY_RETRY_HINTS, retryEvent({ tokenId: "t1" }));
    const b = applyRetryEvent(a, retryEvent({ tokenId: "t2", delayMs: 2000 }));
    expect(b.size).toBe(2);
    expect(b.get("t1")!.delayMs).toBe(5000);
    expect(b.get("t2")!.delayMs).toBe(2000);
  });
});

describe("buildRetryHints", () => {
  it("empty array → empty map", () => {
    expect(buildRetryHints([]).size).toBe(0);
  });

  it("folds add / delete across a stream", () => {
    const events: ReadonlyArray<EngineEvent> = [
      retryEvent({ tokenId: "t1" }),
      retryEvent({ tokenId: "t2" }),
      startEvent("t1"),
    ];
    const hints = buildRetryHints(events);
    expect(hints.size).toBe(1);
    expect(hints.has("t2")).toBe(true);
    expect(hints.has("t1")).toBe(false);
  });

  it("final state reflects last-write-wins", () => {
    const events: ReadonlyArray<EngineEvent> = [
      retryEvent({ tokenId: "t1", attempt: 2, delayMs: 1000 }),
      retryEvent({ tokenId: "t1", attempt: 3, delayMs: 4000 }),
    ];
    const hints = buildRetryHints(events);
    expect(hints.get("t1")!.attempt).toBe(3);
    expect(hints.get("t1")!.delayMs).toBe(4000);
  });
});

describe("formatRetryCountdown", () => {
  const baseHint: RetryHint = {
    tokenId: "t1",
    nodeId: "build",
    attempt: 2,
    scheduledAtMs: SCHEDULED_MS,
    delayMs: 5000,
    reason: "fail",
  };

  it("nowMs before endsAt → positive countdown with 1 decimal", () => {
    // endsAt = SCHEDULED_MS + 5000 → remaining = 3200ms → "3.2s"
    expect(formatRetryCountdown(baseHint, SCHEDULED_MS + 1800)).toBe(
      "retrying in 3.2s",
    );
  });

  it("nowMs exactly at endsAt → '0.0s' (clamped)", () => {
    expect(formatRetryCountdown(baseHint, SCHEDULED_MS + 5000)).toBe(
      "retrying in 0.0s",
    );
  });

  it("nowMs past endsAt → '0.0s' (clamped)", () => {
    expect(formatRetryCountdown(baseHint, SCHEDULED_MS + 9999)).toBe(
      "retrying in 0.0s",
    );
  });

  it("non-finite remainder → '0.0s'", () => {
    const bad: RetryHint = { ...baseHint, scheduledAtMs: NaN };
    expect(formatRetryCountdown(bad, SCHEDULED_MS)).toBe("retrying in 0.0s");
  });

  it("delay < 1s renders as sub-second decimal", () => {
    const short: RetryHint = { ...baseHint, delayMs: 800 };
    expect(formatRetryCountdown(short, SCHEDULED_MS + 200)).toBe(
      "retrying in 0.6s",
    );
  });

  it("long delay (> 10s) formats with 1 decimal", () => {
    const long: RetryHint = { ...baseHint, delayMs: 32_500 };
    expect(formatRetryCountdown(long, SCHEDULED_MS + 15_400)).toBe(
      "retrying in 17.1s",
    );
  });
});
