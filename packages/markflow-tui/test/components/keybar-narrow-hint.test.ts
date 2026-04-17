// test/components/keybar-narrow-hint.test.ts
//
// P8-T2 §4.1 — pure-logic tests for the keybar trailing-hint rule.

import { describe, it, expect } from "vitest";
import {
  KEYS_TIER_HINT,
  composeKeybarTrailingHint,
} from "../../src/components/keybar-narrow-hint.js";

const HINT_LEN = KEYS_TIER_HINT.length;
const SLACK = 4;

describe("KEYS_TIER_HINT", () => {
  it("is the canonical '? for labels' string", () => {
    expect(KEYS_TIER_HINT).toBe("? for labels");
  });
});

describe("composeKeybarTrailingHint", () => {
  it("returns null when tier is 'full'", () => {
    expect(composeKeybarTrailingHint("full", 200, 50)).toBeNull();
  });

  it("returns null when tier is 'short'", () => {
    expect(composeKeybarTrailingHint("short", 80, 50)).toBeNull();
  });

  it("returns the hint at keys tier with ample slack (52 - 19 - 4 = 29)", () => {
    expect(composeKeybarTrailingHint("keys", 52, 19)).toBe(KEYS_TIER_HINT);
  });

  it("returns null at keys tier when slack < hint length (30 - 20 - 4 = 6)", () => {
    expect(composeKeybarTrailingHint("keys", 30, 20)).toBeNull();
  });

  it("exact boundary slack === hint length includes the hint", () => {
    const rowLen = 5;
    const width = rowLen + SLACK + HINT_LEN; // slack = 13 = HINT_LEN
    expect(composeKeybarTrailingHint("keys", width, rowLen)).toBe(
      KEYS_TIER_HINT,
    );
  });

  it("one below boundary drops the hint", () => {
    const rowLen = 5;
    const width = rowLen + SLACK + HINT_LEN - 1;
    expect(composeKeybarTrailingHint("keys", width, rowLen)).toBeNull();
  });
});
