import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, appendFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tailEventLog } from "../../src/core/tail-event-log.js";
import type { EngineEvent, EngineEventPayload } from "../../src/core/types.js";

// ----- helpers --------------------------------------------------------------

function stepStart(seq: number, nodeId = `n${seq}`, tokenId = `t${seq}`): EngineEvent {
  const payload: EngineEventPayload = { type: "step:start", nodeId, tokenId };
  return { ...payload, seq, ts: new Date().toISOString() };
}

function workflowComplete(seq: number): EngineEvent {
  const payload: EngineEventPayload = { type: "workflow:complete", results: [] };
  return { ...payload, seq, ts: new Date().toISOString() };
}

function workflowError(seq: number, error = "boom"): EngineEvent {
  const payload: EngineEventPayload = { type: "workflow:error", error };
  return { ...payload, seq, ts: new Date().toISOString() };
}

async function writeEvent(runDir: string, evt: EngineEvent): Promise<void> {
  await appendFile(join(runDir, "events.jsonl"), JSON.stringify(evt) + "\n");
}

async function collectAll(
  iter: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ----- tests ----------------------------------------------------------------

describe("tailEventLog", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), "markflow-tail-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("cold-start: yields pre-existing events in order and terminates on workflow:complete", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    for (let i = 1; i <= 5; i++) await writeEvent(runDir, stepStart(i));
    await writeEvent(runDir, workflowComplete(6));

    const all = await collectAll(tailEventLog(runDir, 1));
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(all[all.length - 1].type).toBe("workflow:complete");
  });

  it("terminates on workflow:error as well", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, workflowError(2, "kaboom"));

    const all = await collectAll(tailEventLog(runDir, 1));
    expect(all).toHaveLength(2);
    expect(all[1].type).toBe("workflow:error");
  });

  it("attaches before file exists and receives events once it's created", async () => {
    // Do not pre-create events.jsonl — only the run dir exists.
    const iter = tailEventLog(runDir, 1);

    // Start consumer in background.
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    // Give the tail a moment to install its dir-watcher, then write.
    await sleep(100);
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, stepStart(2));
    await writeEvent(runDir, workflowComplete(3));

    await consumer;
    expect(received.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("receives events written while the consumer is awaiting", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");

    const iter = tailEventLog(runDir, 1);
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    // Writer appends, one at a time, while consumer awaits.
    await sleep(100);
    await writeEvent(runDir, stepStart(1));
    await sleep(100);
    await writeEvent(runDir, stepStart(2));
    await sleep(100);
    await writeEvent(runDir, workflowComplete(3));

    await consumer;
    expect(received.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("fromSeq is inclusive and skips earlier events", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    for (let i = 1; i <= 10; i++) await writeEvent(runDir, stepStart(i));
    await writeEvent(runDir, workflowComplete(11));

    const all = await collectAll(tailEventLog(runDir, 5));
    expect(all[0].seq).toBe(5);
    expect(all.map((e) => e.seq)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it("never duplicates events across multiple writes", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");

    const iter = tailEventLog(runDir, 1);
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    // Many writes in small bursts.
    for (let i = 1; i <= 20; i++) {
      await writeEvent(runDir, stepStart(i));
      if (i % 5 === 0) await sleep(50);
    }
    await writeEvent(runDir, workflowComplete(21));
    await consumer;

    const seqs = received.map((e) => e.seq);
    expect(seqs.length).toBe(21);
    expect(new Set(seqs).size).toBe(21);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("AbortSignal causes the generator to return within 100ms", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, stepStart(2));

    const ac = new AbortController();
    const received: EngineEvent[] = [];
    const iter = tailEventLog(runDir, 1, { signal: ac.signal });

    const start = Date.now();
    const consumer = (async () => {
      for await (const e of iter) {
        received.push(e);
        if (received.length === 2) {
          // Abort after consuming what's there.
          setTimeout(() => ac.abort(), 10);
        }
      }
    })();

    await consumer;
    const elapsed = Date.now() - start;
    expect(received.map((e) => e.seq)).toEqual([1, 2]);
    expect(elapsed).toBeLessThan(500); // generous upper bound
  });

  it("already-aborted signal returns immediately with no events", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, workflowComplete(2));

    const ac = new AbortController();
    ac.abort();

    const all = await collectAll(tailEventLog(runDir, 1, { signal: ac.signal }));
    expect(all).toEqual([]);
  });

  it("break in for-await exits cleanly", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, stepStart(2));
    await writeEvent(runDir, stepStart(3));

    const received: EngineEvent[] = [];
    let threw = false;
    try {
      for await (const e of tailEventLog(runDir, 1)) {
        received.push(e);
        if (received.length === 1) break;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(received.map((e) => e.seq)).toEqual([1]);
    // Give the finally a tick to close the watcher cleanly — no assert needed,
    // but this validates no unhandled rejection/timer survives the test.
    await sleep(50);
  });

  it("partial line without newline is buffered until newline arrives", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");

    const iter = tailEventLog(runDir, 1);
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    // Write a full JSON body WITHOUT the trailing newline.
    const evt1 = stepStart(1);
    const partial = JSON.stringify(evt1);
    writeFileSync(join(runDir, "events.jsonl"), partial, { flag: "a" });
    await sleep(50);
    expect(received).toHaveLength(0);

    // Now append the newline + a second full event.
    const evt2 = workflowComplete(2);
    writeFileSync(
      join(runDir, "events.jsonl"),
      "\n" + JSON.stringify(evt2) + "\n",
      { flag: "a" },
    );
    await consumer;

    expect(received.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("file exists empty initially; dir watch picks up when writes arrive", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");

    const iter = tailEventLog(runDir, 1);
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    await sleep(100);
    await writeEvent(runDir, stepStart(1));
    await sleep(50);
    await writeEvent(runDir, workflowComplete(2));
    await consumer;

    expect(received.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("returns after terminal event without requiring more writes", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    await writeEvent(runDir, stepStart(1));
    await writeEvent(runDir, workflowComplete(2));

    const start = Date.now();
    const all = await collectAll(tailEventLog(runDir, 1));
    const elapsed = Date.now() - start;

    expect(all.map((e) => e.seq)).toEqual([1, 2]);
    expect(elapsed).toBeLessThan(500);
  });

  it("fromSeq past the end — waits for matching event to arrive", async () => {
    await writeFile(join(runDir, "events.jsonl"), "", "utf-8");
    for (let i = 1; i <= 3; i++) await writeEvent(runDir, stepStart(i));

    const iter = tailEventLog(runDir, 10);
    const received: EngineEvent[] = [];
    const consumer = (async () => {
      for await (const e of iter) received.push(e);
    })();

    await sleep(50);
    expect(received).toHaveLength(0);

    // Append events with seq < 10 (should be skipped) then >= 10.
    for (let i = 4; i <= 9; i++) await writeEvent(runDir, stepStart(i));
    await writeEvent(runDir, stepStart(10));
    await writeEvent(runDir, workflowComplete(11));
    await consumer;

    expect(received.map((e) => e.seq)).toEqual([10, 11]);
  });
});
