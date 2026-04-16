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
});
