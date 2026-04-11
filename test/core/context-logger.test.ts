import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContextLogger } from "../../src/core/context-logger.js";
import type { StepResult } from "../../src/core/types.js";
import { readFileSync } from "node:fs";

describe("ContextLogger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "markflow-test-"));
  });

  const makeResult = (node: string): StepResult => ({
    node,
    type: "script",
    edge: "pass",
    summary: `${node} completed`,
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:01Z",
    exit_code: 0,
  });

  it("appends and reads back results", async () => {
    const logger = createContextLogger(tempDir);
    await logger.append(makeResult("step1"));
    await logger.append(makeResult("step2"));

    const results = await logger.readAll();
    expect(results).toHaveLength(2);
    expect(results[0].node).toBe("step1");
    expect(results[1].node).toBe("step2");
  });

  it("writes JSONL format (one JSON object per line)", async () => {
    const logger = createContextLogger(tempDir);
    await logger.append(makeResult("a"));
    await logger.append(makeResult("b"));

    const raw = readFileSync(logger.path, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("returns empty array for non-existent file", async () => {
    const logger = createContextLogger(join(tempDir, "nonexistent"));
    const results = await logger.readAll();
    expect(results).toHaveLength(0);
  });
});
