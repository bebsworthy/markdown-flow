import { describe, it, expect } from "vitest";
import { computeRetryDelay, abortableSleep } from "../../src/core/retry.js";
import type { RetryConfig } from "../../src/core/types.js";

describe("computeRetryDelay", () => {
  it("returns 0 when delay is unset", () => {
    const cfg: RetryConfig = { max: 3 };
    expect(computeRetryDelay(cfg, 0)).toBe(0);
    expect(computeRetryDelay(cfg, 5)).toBe(0);
  });

  it("fixed backoff returns the same delay every attempt", () => {
    const cfg: RetryConfig = { max: 5, delay: "10s", backoff: "fixed" };
    expect(computeRetryDelay(cfg, 0)).toBe(10_000);
    expect(computeRetryDelay(cfg, 3)).toBe(10_000);
  });

  it("linear backoff scales with attempt+1", () => {
    const cfg: RetryConfig = { max: 5, delay: "10s", backoff: "linear" };
    expect(computeRetryDelay(cfg, 0)).toBe(10_000);
    expect(computeRetryDelay(cfg, 1)).toBe(20_000);
    expect(computeRetryDelay(cfg, 2)).toBe(30_000);
  });

  it("exponential backoff doubles each attempt", () => {
    const cfg: RetryConfig = { max: 5, delay: "1s", backoff: "exponential" };
    expect(computeRetryDelay(cfg, 0)).toBe(1_000);
    expect(computeRetryDelay(cfg, 1)).toBe(2_000);
    expect(computeRetryDelay(cfg, 2)).toBe(4_000);
    expect(computeRetryDelay(cfg, 3)).toBe(8_000);
  });

  it("maxDelay caps the computed delay", () => {
    const cfg: RetryConfig = {
      max: 10,
      delay: "1s",
      backoff: "exponential",
      maxDelay: "5s",
    };
    expect(computeRetryDelay(cfg, 2)).toBe(4_000);
    expect(computeRetryDelay(cfg, 3)).toBe(5_000);
    expect(computeRetryDelay(cfg, 10)).toBe(5_000);
  });

  it("jitter keeps delay within ±fraction window", () => {
    const cfg: RetryConfig = {
      max: 3,
      delay: "10s",
      backoff: "fixed",
      jitter: 0.3,
    };
    // With rand() = 0.5, multiplier is exactly 1 → baseline.
    expect(computeRetryDelay(cfg, 0, () => 0.5)).toBe(10_000);
    // rand() = 0 → multiplier = 1 - 0.3 = 0.7
    expect(computeRetryDelay(cfg, 0, () => 0)).toBe(7_000);
    // rand() = 1 → multiplier = 1 + 0.3 = 1.3
    expect(computeRetryDelay(cfg, 0, () => 1)).toBe(13_000);
  });

  it("jitter=0 produces deterministic output", () => {
    const cfg: RetryConfig = { max: 3, delay: "5s", jitter: 0 };
    expect(computeRetryDelay(cfg, 0, () => 0)).toBe(5_000);
    expect(computeRetryDelay(cfg, 0, () => 1)).toBe(5_000);
  });
});

describe("abortableSleep", () => {
  it("resolves after the specified ms", async () => {
    const start = Date.now();
    await abortableSleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("returns immediately for ms <= 0", async () => {
    const start = Date.now();
    await abortableSleep(0);
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("rejects when signal aborts during sleep", async () => {
    const ac = new AbortController();
    const p = abortableSleep(1_000, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow();
  });

  it("rejects immediately when signal already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(abortableSleep(1_000, ac.signal)).rejects.toThrow();
  });
});
