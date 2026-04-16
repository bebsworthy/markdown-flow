// test/runs/duration.test.ts
//
// Pure-unit tests for `tryParseDurationMs` (P5-T2 §10.1). The function
// mirrors a subset of the engine's `parseDuration` grammar but never
// throws — malformed input yields `null` so the filter UI can annotate
// the term without crashing.

import { describe, it, expect } from "vitest";
import { tryParseDurationMs } from "../../src/runs/duration.js";

describe("tryParseDurationMs — single-unit grammar", () => {
  it("parses `30s` → 30_000 ms", () => {
    expect(tryParseDurationMs("30s")).toBe(30_000);
  });

  it("parses `5m` → 300_000 ms", () => {
    expect(tryParseDurationMs("5m")).toBe(300_000);
  });

  it("parses `1h` → 3_600_000 ms", () => {
    expect(tryParseDurationMs("1h")).toBe(3_600_000);
  });

  it("parses `2d` → 172_800_000 ms", () => {
    expect(tryParseDurationMs("2d")).toBe(172_800_000);
  });
});

describe("tryParseDurationMs — compound grammar", () => {
  it("parses `1h30m` → 5_400_000 ms", () => {
    expect(tryParseDurationMs("1h30m")).toBe(5_400_000);
  });

  it("parses `2h15m30s` → 8_130_000 ms", () => {
    expect(tryParseDurationMs("2h15m30s")).toBe(8_130_000);
  });
});

describe("tryParseDurationMs — rejections", () => {
  it("rejects empty string", () => {
    expect(tryParseDurationMs("")).toBeNull();
  });

  it("rejects a random word", () => {
    expect(tryParseDurationMs("garbage")).toBeNull();
  });

  it("rejects `0s` (zero duration is nonsense for a filter)", () => {
    expect(tryParseDurationMs("0s")).toBeNull();
  });

  it("rejects `1.5h` (no decimals)", () => {
    expect(tryParseDurationMs("1.5h")).toBeNull();
  });

  it("rejects `1` (missing unit)", () => {
    expect(tryParseDurationMs("1")).toBeNull();
  });

  it("rejects trailing garbage", () => {
    expect(tryParseDurationMs("1hxy")).toBeNull();
  });
});

describe("tryParseDurationMs — normalisation", () => {
  it("case-insensitive (`1H` → 3_600_000)", () => {
    expect(tryParseDurationMs("1H")).toBe(3_600_000);
  });

  it("trims surrounding whitespace (` 30s ` → 30_000)", () => {
    expect(tryParseDurationMs(" 30s ")).toBe(30_000);
  });
});
