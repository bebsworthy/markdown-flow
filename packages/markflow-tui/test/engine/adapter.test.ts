// test/engine/adapter.test.ts
//
// Unit tests for `createEngineAdapter`. Covers the P3-T2 acceptance
// criteria:
//   - list pump yields `{kind:"list", …}` events
//   - per-run tail yields `{kind:"run", …}` + `{kind:"run:detached", …}`
//   - AbortSignal teardown — no polling, unsubscribes cleanly on unmount
//   - runId swap via adapter re-creation does not drop list events
//
// Reference: docs/tui/plans/P3-T2.md §8.2.
//
// NOTE: `markflow` is consumed as a compiled workspace dep (see
// `packages/markflow/package.json` → main `dist/core/index.js`). If the
// engine package is not built, the import will fail. Validation plan in
// the plan's §10 runs `npm run build -w packages/markflow` first.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngineAdapter } from "../../src/engine/adapter.js";
import type { EngineAdapterEvent } from "../../src/engine/types.js";
import {
  appendEvent,
  cleanup,
  delay,
  makeRun,
  makeRunsDir,
  stepStart,
  workflowComplete,
} from "./helpers.js";

/**
 * Collects events from the adapter until either:
 *   - `until(events)` returns true
 *   - `timeoutMs` elapses (throws)
 *
 * Also returns a cleanup function the caller can use to drain-stop the
 * iteration without touching the controller directly.
 */
async function collect(
  iter: AsyncIterable<EngineAdapterEvent>,
  until: (events: EngineAdapterEvent[]) => boolean,
  timeoutMs = 2000,
): Promise<EngineAdapterEvent[]> {
  const events: EngineAdapterEvent[] = [];
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timeoutHandle = setTimeout(
      () =>
        rej(
          new Error(
            `adapter.collect timed out after ${timeoutMs}ms (have ${events.length})`,
          ),
        ),
      timeoutMs,
    );
  });
  const drain = (async (): Promise<void> => {
    for await (const ev of iter) {
      events.push(ev);
      if (until(events)) return;
    }
  })();
  try {
    await Promise.race([drain, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  return events;
}

describe("createEngineAdapter — list pump", () => {
  const runsDirs: string[] = [];

  beforeEach(async () => {
    runsDirs.push(await makeRunsDir());
  });

  afterEach(async () => {
    await cleanup(runsDirs.splice(0));
  });

  it("yields list updates when existing runs are present", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    await makeRun(runsDir, "run-a");
    await makeRun(runsDir, "run-b");

    const ac = new AbortController();
    const adapter = createEngineAdapter({ runsDir, signal: ac.signal });
    try {
      const events = await collect(
        adapter,
        (evs) => evs.filter((e) => e.kind === "list").length >= 2,
      );
      const listEvents = events.filter((e) => e.kind === "list");
      expect(listEvents.length).toBe(2);
      for (const e of listEvents) {
        if (e.kind !== "list") throw new Error("unreachable");
        expect(e.event.kind).toBe("added");
      }
      const seen = new Set(
        listEvents.flatMap((e) =>
          e.kind === "list" ? [e.event.runId] : [],
        ),
      );
      expect(seen).toEqual(new Set(["run-a", "run-b"]));
    } finally {
      ac.abort();
    }
  });

  it("yields a list event when a new run appears mid-stream", { timeout: 15_000 }, async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    const ac = new AbortController();
    const adapter = createEngineAdapter({ runsDir, signal: ac.signal });
    try {
      // Start consuming in background, then create a run.
      const collected: EngineAdapterEvent[] = [];
      const consumer = (async (): Promise<void> => {
        for await (const ev of adapter) {
          collected.push(ev);
          if (collected.length >= 1) break;
        }
      })();
      await delay(50);
      await makeRun(runsDir, "run-live");
      await consumer;
      expect(collected).toHaveLength(1);
      const [ev] = collected;
      expect(ev.kind).toBe("list");
      if (ev.kind === "list") {
        expect(ev.event.kind).toBe("added");
        expect(ev.event.runId).toBe("run-live");
      }
    } finally {
      ac.abort();
    }
  });
});

describe("createEngineAdapter — per-run tail", () => {
  const runsDirs: string[] = [];

  beforeEach(async () => {
    runsDirs.push(await makeRunsDir());
  });

  afterEach(async () => {
    await cleanup(runsDirs.splice(0));
  });

  it("yields per-run engine events and a terminal run:detached", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    const runDir = await makeRun(runsDir, "run-tail");
    // Pre-populate events including a workflow:complete.
    await appendEvent(runDir, stepStart(1));
    await appendEvent(runDir, stepStart(2));
    await appendEvent(runDir, stepStart(3));
    await appendEvent(runDir, workflowComplete(4));

    const ac = new AbortController();
    const adapter = createEngineAdapter({
      runsDir,
      runId: "run-tail",
      fromSeq: 1,
      signal: ac.signal,
    });
    try {
      const events = await collect(
        adapter,
        (evs) => evs.some((e) => e.kind === "run:detached"),
      );
      const runEvents = events.filter((e) => e.kind === "run");
      expect(runEvents.length).toBe(4);
      const detached = events.find((e) => e.kind === "run:detached");
      expect(detached).toBeDefined();
      if (detached && detached.kind === "run:detached") {
        expect(detached.runId).toBe("run-tail");
        expect(detached.reason).toBe("terminal");
      }
    } finally {
      ac.abort();
    }
  });

  it("honours fromSeq when replaying a partially-consumed log", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    const runDir = await makeRun(runsDir, "run-skip");
    await appendEvent(runDir, stepStart(1));
    await appendEvent(runDir, stepStart(2));
    await appendEvent(runDir, stepStart(3));
    await appendEvent(runDir, workflowComplete(4));

    const ac = new AbortController();
    const adapter = createEngineAdapter({
      runsDir,
      runId: "run-skip",
      fromSeq: 3,
      signal: ac.signal,
    });
    try {
      const events = await collect(
        adapter,
        (evs) => evs.some((e) => e.kind === "run:detached"),
      );
      const runEvents = events.filter((e) => e.kind === "run");
      // seq 3 and 4 only.
      expect(runEvents.length).toBe(2);
      const seqs = runEvents.flatMap((e) =>
        e.kind === "run" ? [e.event.seq] : [],
      );
      expect(seqs).toEqual([3, 4]);
    } finally {
      ac.abort();
    }
  });
});

describe("createEngineAdapter — abort behaviour", () => {
  const runsDirs: string[] = [];

  beforeEach(async () => {
    runsDirs.push(await makeRunsDir());
  });

  afterEach(async () => {
    await cleanup(runsDirs.splice(0));
  });

  it("stops yielding after controller.abort()", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    await makeRun(runsDir, "run-a");
    const ac = new AbortController();
    const adapter = createEngineAdapter({ runsDir, signal: ac.signal });

    const collected: EngineAdapterEvent[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of adapter) {
        collected.push(ev);
      }
    })();

    // Wait for the initial list burst.
    await delay(100);
    ac.abort();
    // Must exit within a reasonable budget.
    await Promise.race([
      consumer,
      new Promise<void>((_, rej) =>
        setTimeout(() => rej(new Error("hung after abort")), 1000),
      ),
    ]);

    const preLen = collected.length;
    // New run after abort should NOT be delivered.
    await makeRun(runsDir, "run-after-abort");
    await delay(150);
    expect(collected.length).toBe(preLen);
  });

  it("returns immediately when constructed with an already-aborted signal", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    await makeRun(runsDir, "run-a");
    const ac = new AbortController();
    ac.abort();
    const adapter = createEngineAdapter({ runsDir, signal: ac.signal });

    const start = Date.now();
    const collected: EngineAdapterEvent[] = [];
    for await (const ev of adapter) {
      collected.push(ev);
    }
    const elapsed = Date.now() - start;
    // Should exit essentially instantly — generous 500ms budget for CI.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("createEngineAdapter — re-create pattern (runId swap)", () => {
  const runsDirs: string[] = [];

  beforeEach(async () => {
    runsDirs.push(await makeRunsDir());
  });

  afterEach(async () => {
    await cleanup(runsDirs.splice(0));
  });

  it("re-created adapter still observes existing runs as added", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    await makeRun(runsDir, "r1");
    await makeRun(runsDir, "r2");

    // Adapter A — runId=r1, torn down immediately.
    const acA = new AbortController();
    const adapterA = createEngineAdapter({
      runsDir,
      runId: "r1",
      signal: acA.signal,
    });
    const drainA = (async (): Promise<void> => {
      for await (const _ev of adapterA) {
        // drain
      }
    })();
    await delay(100);
    acA.abort();
    await drainA;

    // Adapter B — runId=r2. Should still see r1 and r2 as `added`.
    const acB = new AbortController();
    const adapterB = createEngineAdapter({
      runsDir,
      runId: "r2",
      signal: acB.signal,
    });
    try {
      const events = await collect(
        adapterB,
        (evs) => evs.filter((e) => e.kind === "list").length >= 2,
      );
      const listIds = new Set(
        events.flatMap((e) =>
          e.kind === "list" ? [e.event.runId] : [],
        ),
      );
      expect(listIds).toEqual(new Set(["r1", "r2"]));
    } finally {
      acB.abort();
    }
  });
});

describe("createEngineAdapter — interleaving", () => {
  const runsDirs: string[] = [];

  beforeEach(async () => {
    runsDirs.push(await makeRunsDir());
  });

  afterEach(async () => {
    await cleanup(runsDirs.splice(0));
  });

  it("list events and run events interleave without deadlock", async () => {
    const runsDir = runsDirs[runsDirs.length - 1];
    const activeDir = await makeRun(runsDir, "run-active");

    const ac = new AbortController();
    const adapter = createEngineAdapter({
      runsDir,
      runId: "run-active",
      fromSeq: 1,
      signal: ac.signal,
    });

    const collected: EngineAdapterEvent[] = [];
    const consumer = (async (): Promise<void> => {
      for await (const ev of adapter) {
        collected.push(ev);
        if (
          collected.some(
            (e) =>
              e.kind === "list" &&
              e.event.kind === "added" &&
              e.event.runId === "run-new",
          ) &&
          collected.some(
            (e) => e.kind === "run" && e.event.seq === 1,
          )
        ) {
          return;
        }
      }
    })();

    await delay(50);
    // Writer 1: append engine event to active run.
    await appendEvent(activeDir, stepStart(1));
    // Writer 2: create a new run dir.
    await makeRun(runsDir, "run-new");

    await Promise.race([
      consumer,
      new Promise<void>((_, rej) =>
        setTimeout(() => rej(new Error("interleave timed out")), 2000),
      ),
    ]);

    expect(
      collected.some((e) => e.kind === "run" && e.event.seq === 1),
    ).toBe(true);
    expect(
      collected.some(
        (e) =>
          e.kind === "list" &&
          e.event.kind === "added" &&
          e.event.runId === "run-new",
      ),
    ).toBe(true);

    ac.abort();
  });
});

describe("createEngineAdapter — option validation", () => {
  it("throws synchronously (via the iterator) when no runsDir and no runManager provided", async () => {
    const ac = new AbortController();
    // The error surfaces when the iterator is actually consumed.
    const adapter = createEngineAdapter({
      signal: ac.signal,
      runId: "anything",
    });
    let error: unknown;
    try {
      for await (const _ev of adapter) {
        // unreachable
      }
    } catch (err) {
      error = err;
    } finally {
      ac.abort();
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/runsDir is required/);
  });
});
