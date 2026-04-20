import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEventLog } from "../../src/core/replay.js";
import { TruncatedLogError } from "../../src/core/types.js";

describe("readEventLog truncation handling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "markflow-trunc-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const line = (obj: object) => JSON.stringify(obj) + "\n";
  const goodA = line({
    type: "run:start",
    v: 1,
    runId: "r1",
    workflowName: "x",
    sourceFile: "x.md",
    inputs: {},
    configResolved: {},
    seq: 1,
    ts: "t",
  });
  const goodB = line({
    type: "token:created",
    tokenId: "t1",
    nodeId: "a",
    generation: 0,
    seq: 2,
    ts: "t",
  });

  it("returns empty list for empty file", async () => {
    await writeFile(join(dir, "events.jsonl"), "");
    expect(await readEventLog(dir)).toEqual([]);
  });

  it("reads a complete newline-terminated log", async () => {
    await writeFile(join(dir, "events.jsonl"), goodA + goodB);
    const evs = await readEventLog(dir);
    expect(evs).toHaveLength(2);
  });

  it("tolerates a truncated trailing record (no newline)", async () => {
    // Simulate crash mid-write: last line is partial JSON with no newline.
    const partial = '{"type":"token:created","tokenId":"t2"';
    await writeFile(join(dir, "events.jsonl"), goodA + goodB + partial);
    const evs = await readEventLog(dir);
    // The two complete records survive; the partial tail is dropped.
    expect(evs).toHaveLength(2);
    expect(evs[1].type).toBe("token:created");
  });

  it("throws TruncatedLogError on a bad record that is NOT the last line", async () => {
    // A malformed JSON line in the middle followed by a complete record means
    // the log is genuinely corrupted, not just truncated by a crash.
    const bad = '{"type":"broken"' + "\n";
    await writeFile(join(dir, "events.jsonl"), goodA + bad + goodB);
    await expect(readEventLog(dir)).rejects.toThrow(TruncatedLogError);
  });

  it("throws TruncatedLogError when the last line is bad AND file ends with newline", async () => {
    // Trailing newline indicates the writer believed it had finished the
    // line, so a parse failure here is real corruption.
    const bad = '{"type":"broken"' + "\n";
    await writeFile(join(dir, "events.jsonl"), goodA + bad);
    await expect(readEventLog(dir)).rejects.toThrow(TruncatedLogError);
  });

  it("TruncatedLogError carries a byte offset", async () => {
    const bad = '{"type":"broken"' + "\n";
    await writeFile(join(dir, "events.jsonl"), goodA + bad);
    try {
      await readEventLog(dir);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TruncatedLogError);
      expect((err as TruncatedLogError).byteOffset).toBe(goodA.length);
    }
  });
});
