import { describe, it, expect } from "vitest";
import { parseDuration } from "../../src/core/duration.js";
import { ConfigError } from "../../src/core/errors.js";

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("parses compound durations", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("2h15m30s")).toBe(8_130_000);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseDuration("  1H30M  ")).toBe(5_400_000);
  });

  it("throws on empty string", () => {
    expect(() => parseDuration("")).toThrow(ConfigError);
  });

  it("throws on unrecognized units", () => {
    expect(() => parseDuration("5d")).toThrow(ConfigError);
    expect(() => parseDuration("100ms")).toThrow(ConfigError);
  });

  it("throws on bare numbers", () => {
    expect(() => parseDuration("30")).toThrow(ConfigError);
  });

  it("throws on garbage input", () => {
    expect(() => parseDuration("abc")).toThrow(ConfigError);
    expect(() => parseDuration("5m extra")).toThrow(ConfigError);
  });

  // Protects against: "0s" accidentally passing validation (total===0 check)
  it("rejects zero-value duration '0s'", () => {
    expect(() => parseDuration("0s")).toThrow(ConfigError);
  });

  // Protects against: "0m" or "0h" being silently accepted
  it("rejects zero-value duration '0m' and '0h'", () => {
    expect(() => parseDuration("0m")).toThrow(ConfigError);
    expect(() => parseDuration("0h")).toThrow(ConfigError);
  });

  // Protects against: negative durations parsing as valid
  it("rejects negative duration strings", () => {
    expect(() => parseDuration("-5s")).toThrow(ConfigError);
    expect(() => parseDuration("-1h")).toThrow(ConfigError);
  });

  // Protects against: non-string input not being caught
  it("throws on non-string input", () => {
    expect(() => parseDuration(42 as any)).toThrow(ConfigError);
    expect(() => parseDuration(null as any)).toThrow(ConfigError);
  });
});
