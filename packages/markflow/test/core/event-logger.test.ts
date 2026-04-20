import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEventLogger } from "../../src/core/event-logger.js";
import type { EngineEvent } from "../../src/core/types.js";

describe("EventLogger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "markflow-evt-"));
    await writeFile(join(tempDir, "events.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stamps monotonic seq and ISO ts on each event", async () => {
    const logger = createEventLogger(tempDir);
    const a = await logger.append({
      type: "step:start",
      nodeId: "a",
      tokenId: "t1",
    });
    const b = await logger.append({
      type: "step:start",
      nodeId: "b",
      tokenId: "t2",
    });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(new Date(a.ts).toString()).not.toBe("Invalid Date");
  });

  it("serializes concurrent appends into monotonic on-disk order", async () => {
    const logger = createEventLogger(tempDir);
    // Fire 20 appends without awaiting between them — seq must still be 1..20
    // in both the returned envelopes AND the on-disk line order.
    const promises: Promise<EngineEvent>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        logger.append({ type: "step:start", nodeId: `n${i}`, tokenId: `t${i}` }),
      );
    }
    const stamped = await Promise.all(promises);
    expect(stamped.map((e) => e.seq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );

    const raw = readFileSync(logger.path, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(20);
    const onDiskSeqs = lines.map((l) => (JSON.parse(l) as EngineEvent).seq);
    expect(onDiskSeqs).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("does not persist in-memory-only event types (step:output)", async () => {
    const logger = createEventLogger(tempDir);
    const stamped = await logger.append({
      type: "step:output",
      nodeId: "n",
      stream: "stdout",
      chunk: "hello\n",
    });
    // Seq still assigned — consumers rely on stable ordering across all events.
    expect(stamped.seq).toBe(1);

    const raw = readFileSync(logger.path, "utf-8");
    expect(raw).toBe("");
  });

  it("advances seq through persisted and non-persisted events alike", async () => {
    const logger = createEventLogger(tempDir);
    const a = await logger.append({ type: "step:start", nodeId: "a", tokenId: "t" });
    const b = await logger.append({
      type: "step:output",
      nodeId: "a",
      stream: "stdout",
      chunk: "x",
    });
    const c = await logger.append({ type: "workflow:complete", results: [] });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);

    const onDiskSeqs = readFileSync(logger.path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as EngineEvent).seq);
    // b was not persisted; disk holds seq 1 and 3 only.
    expect(onDiskSeqs).toEqual([1, 3]);
  });

  // Protects against: createEventLoggerFromExisting not continuing seq correctly
  it("createEventLoggerFromExisting continues seq from the given lastSeq", async () => {
    const { createEventLoggerFromExisting } = await import(
      "../../src/core/event-logger.js"
    );
    const logger = createEventLoggerFromExisting(tempDir, 100);
    const a = await logger.append({
      type: "step:start",
      nodeId: "a",
      tokenId: "t1",
    });
    const b = await logger.append({
      type: "step:start",
      nodeId: "b",
      tokenId: "t2",
    });
    expect(a.seq).toBe(101);
    expect(b.seq).toBe(102);

    const raw = readFileSync(logger.path, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    const onDiskSeqs = lines.map(
      (l) => (JSON.parse(l) as EngineEvent).seq,
    );
    expect(onDiskSeqs).toEqual([101, 102]);
  });

  it("uses injected clock for ts", async () => {
    let n = 0;
    const logger = createEventLogger(tempDir, {
      now: () => `2026-01-01T00:00:${String(n++).padStart(2, "0")}.000Z`,
    });
    const a = await logger.append({ type: "step:start", nodeId: "a", tokenId: "t" });
    const b = await logger.append({ type: "step:start", nodeId: "b", tokenId: "t" });
    expect(a.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(b.ts).toBe("2026-01-01T00:00:01.000Z");
  });
});
