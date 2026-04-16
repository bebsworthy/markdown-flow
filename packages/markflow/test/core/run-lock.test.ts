import { describe, it, expect, beforeEach } from "vitest";
import { access, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createRunManager,
  RunLockedError,
} from "../../src/core/index.js";
import { acquireRunLock, lockPathFor } from "../../src/core/run-lock.js";

/**
 * Write a minimal run fixture: empty `events.jsonl` + a valid `meta.json`
 * shaped like the one `createRun` emits. `openExistingRun` only needs these
 * two files plus the `workdir/` (which it `mkdir -p`'s itself). Status is
 * "suspended" so the CLI's replay-based resumable check would accept it,
 * though this test only hits `openExistingRun` directly.
 */
async function writeMinimalRun(runPath: string): Promise<void> {
  await mkdir(runPath, { recursive: true });
  await writeFile(join(runPath, "events.jsonl"), "", "utf-8");
  const meta = {
    workflowName: "test",
    sourceFile: "/dev/null",
    startedAt: new Date().toISOString(),
    status: "suspended" as const,
  };
  await writeFile(
    join(runPath, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

describe("run lock", () => {
  let runsDir: string;
  const runId = "2026-01-01T00-00-00-000Z";

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "markflow-lock-"));
    await writeMinimalRun(join(runsDir, runId));
  });

  it("round-trip: openExistingRun returns release; .lock exists then is gone", async () => {
    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(runId);
    expect(typeof handle.release).toBe("function");

    const lockPath = lockPathFor(join(runsDir, runId));
    await expect(access(lockPath)).resolves.toBeUndefined();

    await handle.release();
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("second acquire throws RunLockedError and fails fast", async () => {
    const manager = createRunManager(runsDir);
    const h1 = await manager.openExistingRun(runId);

    const start = Date.now();
    const raceWinner = await Promise.race([
      manager
        .openExistingRun(runId)
        .then(() => ({ kind: "resolved" as const }))
        .catch((err) => ({ kind: "rejected" as const, err })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), 500),
      ),
    ]);

    expect(raceWinner.kind).toBe("rejected");
    if (raceWinner.kind === "rejected") {
      expect(raceWinner.err).toBeInstanceOf(RunLockedError);
      expect((raceWinner.err as RunLockedError).runId).toBe(runId);
      expect((raceWinner.err as RunLockedError).lockPath).toBe(
        lockPathFor(join(runsDir, runId)),
      );
    }
    expect(Date.now() - start).toBeLessThan(500);

    await h1.release();
  });

  it("release permits subsequent acquire", async () => {
    const manager = createRunManager(runsDir);
    const h1 = await manager.openExistingRun(runId);
    await h1.release();

    const h2 = await manager.openExistingRun(runId);
    expect(h2).toBeDefined();
    await h2.release();
  });

  it("lock file is cleaned up after release", async () => {
    const manager = createRunManager(runsDir);
    const h1 = await manager.openExistingRun(runId);
    await h1.release();

    await expect(access(lockPathFor(join(runsDir, runId)))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("release is idempotent", async () => {
    const manager = createRunManager(runsDir);
    const h1 = await manager.openExistingRun(runId);

    await expect(h1.release()).resolves.toBeUndefined();
    // Second release must not throw even though the lock directory is gone.
    await expect(h1.release()).resolves.toBeUndefined();
  });

  it("stale lock is reclaimed", async () => {
    const runPath = join(runsDir, runId);
    const lockPath = lockPathFor(runPath);

    // Acquire at the low-level adapter so we can forge a stale mtime without
    // the auto-refresh timer keeping it fresh. Shift the lock dir's mtime
    // 5 minutes into the past — well beyond our 30s stale threshold.
    const release = await acquireRunLock(runPath);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await utimes(lockPath, fiveMinutesAgo, fiveMinutesAgo);

    // A second acquire should reclaim the stale lock and succeed rather than
    // throw RunLockedError.
    const reclaim = await acquireRunLock(runPath);
    await reclaim();

    // Releasing the original is a no-op (the dir is gone under it). Must
    // not throw.
    await expect(release()).resolves.toBeUndefined();
  });
});
