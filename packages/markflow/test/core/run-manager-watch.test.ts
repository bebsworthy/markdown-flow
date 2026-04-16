import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunManager,
  type RunEvent,
  type RunStatus,
} from "../../src/core/index.js";

/**
 * Collects events from the iterator until either:
 * - `until(events)` returns true
 * - `timeoutMs` elapses (throws)
 * The iterator is not aborted by this helper — the caller manages the
 * `AbortController` so teardown is explicit.
 */
async function collect(
  iter: AsyncIterable<RunEvent>,
  until: (events: RunEvent[]) => boolean,
  timeoutMs = 1500,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timeoutHandle = setTimeout(
      () => rej(new Error(`collect timed out (have ${events.length})`)),
      timeoutMs,
    );
  });
  const drain = (async () => {
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

/** Write a minimal valid run directory so `getRun` returns a non-null snapshot. */
async function makeRunDir(
  runsDir: string,
  runId: string,
  opts: { status?: RunStatus; completedAt?: string } = {},
): Promise<string> {
  const runPath = join(runsDir, runId);
  await mkdir(runPath, { recursive: true });
  const meta = {
    workflowName: `wf-${runId}`,
    sourceFile: `/fake/${runId}.md`,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: opts.status ?? "running",
    ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
  };
  await writeFile(
    join(runPath, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
  await writeFile(join(runPath, "events.jsonl"), "", "utf-8");
  return runPath;
}

async function updateMeta(
  runsDir: string,
  runId: string,
  patch: { status?: RunStatus; completedAt?: string },
): Promise<void> {
  const runPath = join(runsDir, runId);
  const meta = {
    workflowName: `wf-${runId}`,
    sourceFile: `/fake/${runId}.md`,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: patch.status ?? "running",
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
  };
  await writeFile(
    join(runPath, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("RunManager.watch", () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "markflow-watch-"));
  });

  it("emits nothing when the runs dir is empty", async () => {
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });
    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();
    try {
      await delay(200);
      ac.abort();
      await drain;
    } finally {
      ac.abort();
    }
    expect(collected).toEqual([]);
  });

  it("emits added for each existing run on startup", async () => {
    await makeRunDir(runsDir, "run-a");
    await makeRunDir(runsDir, "run-b");

    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });
    try {
      const events = await collect(iter, (evs) => evs.length >= 2);
      expect(events.length).toBe(2);
      expect(events[0].kind).toBe("added");
      expect(events[1].kind).toBe("added");
      expect(new Set(events.map((e) => e.runId))).toEqual(
        new Set(["run-a", "run-b"]),
      );
      for (const ev of events) {
        if (ev.kind !== "removed") {
          expect(ev.snapshot.id).toBe(ev.runId);
        }
      }
    } finally {
      ac.abort();
    }
  });

  it("emits added when a new run directory appears", async () => {
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });
    try {
      // Give the watcher time to attach
      await delay(50);
      await makeRunDir(runsDir, "run-new");
      const events = await collect(iter, (evs) => evs.length >= 1);
      expect(events.length).toBe(1);
      expect(events[0].kind).toBe("added");
      expect(events[0].runId).toBe("run-new");
    } finally {
      ac.abort();
    }
  });

  it("emits updated when meta.json is rewritten", async () => {
    await makeRunDir(runsDir, "run-x", { status: "running" });
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });

    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();

    try {
      // Wait for initial added
      while (collected.length < 1) await delay(10);
      expect(collected[0].kind).toBe("added");

      // Give a tick for the meta watcher to arm
      await delay(30);
      await updateMeta(runsDir, "run-x", {
        status: "complete",
        completedAt: "2026-01-01T00:01:00.000Z",
      });

      const deadline = Date.now() + 1500;
      while (collected.length < 2 && Date.now() < deadline) await delay(10);

      expect(collected.length).toBeGreaterThanOrEqual(2);
      const updated = collected[1];
      expect(updated.kind).toBe("updated");
      if (updated.kind === "updated") {
        expect(updated.runId).toBe("run-x");
        expect(updated.snapshot.status).toBe("complete");
      }
    } finally {
      ac.abort();
      await drain;
    }
  });

  it("debounces 3 rapid meta.json writes into one updated", async () => {
    await makeRunDir(runsDir, "run-d", { status: "running" });
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });

    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();

    try {
      // Wait for initial added
      while (collected.length < 1) await delay(10);
      expect(collected[0].kind).toBe("added");

      // Three writes in a tight loop
      await updateMeta(runsDir, "run-d", { status: "running" });
      await updateMeta(runsDir, "run-d", { status: "suspended" });
      await updateMeta(runsDir, "run-d", {
        status: "complete",
        completedAt: "2026-01-01T00:01:00.000Z",
      });

      // Wait past the debounce window + some slack
      await delay(200);

      const updates = collected.filter((e) => e.kind === "updated");
      expect(updates.length).toBe(1);
      if (updates[0].kind === "updated") {
        expect(updates[0].snapshot.status).toBe("complete");
      }
    } finally {
      ac.abort();
      await drain;
    }
  });

  it("emits removed when a run directory is deleted", async () => {
    await makeRunDir(runsDir, "run-r");
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });

    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();

    try {
      while (collected.length < 1) await delay(10);
      expect(collected[0].kind).toBe("added");

      await rm(join(runsDir, "run-r"), { recursive: true, force: true });

      const deadline = Date.now() + 2000;
      while (collected.length < 2 && Date.now() < deadline) await delay(10);

      expect(collected.length).toBeGreaterThanOrEqual(2);
      expect(collected[1].kind).toBe("removed");
      expect(collected[1].runId).toBe("run-r");
    } finally {
      ac.abort();
      await drain;
    }
  });

  it("returns from the generator promptly on AbortSignal", async () => {
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });

    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();

    await delay(50);
    ac.abort();

    await Promise.race([
      drain,
      new Promise<void>((_, rej) =>
        setTimeout(() => rej(new Error("hung after abort")), 1000),
      ),
    ]);

    // After abort, a newly-created run should NOT be yielded.
    const preLen = collected.length;
    await makeRunDir(runsDir, "run-after-abort");
    await delay(150);
    expect(collected.length).toBe(preLen);
  });

  it("emits added before updated for the same run created then modified", async () => {
    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });

    const collected: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of iter) collected.push(ev);
    })();

    try {
      await delay(50);
      await makeRunDir(runsDir, "run-ab", { status: "running" });
      // Wait long enough to see the added AND for the meta watcher to attach
      while (collected.filter((e) => e.runId === "run-ab").length < 1) {
        await delay(10);
      }
      // Give a tick for the meta watcher to arm
      await delay(30);
      await updateMeta(runsDir, "run-ab", {
        status: "complete",
        completedAt: "2026-01-01T00:01:00.000Z",
      });

      // Wait for at least one update
      const deadline = Date.now() + 1500;
      while (
        collected.filter((e) => e.runId === "run-ab" && e.kind === "updated")
          .length < 1 &&
        Date.now() < deadline
      ) {
        await delay(10);
      }

      const forRun = collected.filter((e) => e.runId === "run-ab");
      expect(forRun.length).toBeGreaterThanOrEqual(2);
      expect(forRun[0].kind).toBe("added");
      expect(forRun[1].kind).toBe("updated");
    } finally {
      ac.abort();
      await drain;
    }
  });

  it("startup added events are in ascending alphabetical runId order", async () => {
    // Create out of lexicographic order: ccc first, then aaa, then bbb.
    await makeRunDir(runsDir, "ccc");
    await makeRunDir(runsDir, "aaa");
    await makeRunDir(runsDir, "bbb");

    const manager = createRunManager(runsDir);
    const ac = new AbortController();
    const iter = manager.watch({ signal: ac.signal });
    try {
      const events = await collect(iter, (evs) => evs.length >= 3);
      expect(events.map((e) => e.runId)).toEqual(["aaa", "bbb", "ccc"]);
      for (const ev of events) {
        expect(ev.kind).toBe("added");
      }
    } finally {
      ac.abort();
    }
  });
});
