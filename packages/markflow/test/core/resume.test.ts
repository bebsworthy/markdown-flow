import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  createRunManager,
  WorkflowEngine,
  readEventLog,
  replay,
} from "../../src/core/index.js";
import type { EngineEvent } from "../../src/core/index.js";
import { WorkflowChangedError } from "../../src/core/errors.js";
import { lockPathFor } from "../../src/core/run-lock.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

const LINEAR = readFileSync(join(FIXTURES, "linear.md"), "utf-8");

describe("engine resume", () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "markflow-resume-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("round-trip: truncate mid-run, resume, complete", async () => {
    const def = parseWorkflowFromString(LINEAR);

    // Reference: run to completion fresh.
    const ref = await executeWorkflow(def, { runsDir });
    const refSnapshot = replay(await readEventLog(join(runsDir, ref.id)));

    const runInfo = await executeWorkflow(def, { runsDir });
    // Truncate to simulate a crash after step 1 routed but before step 2 started.
    const fullLog = await readEventLog(join(runsDir, runInfo.id));
    const runningIdxs = fullLog
      .map((e, i) => (e.type === "token:state" && e.to === "running" ? i : -1))
      .filter((i) => i >= 0);
    expect(runningIdxs.length).toBeGreaterThanOrEqual(2);
    const truncatedLog = fullLog.slice(0, runningIdxs[1]);
    const truncatedRaw =
      truncatedLog.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(join(runsDir, runInfo.id, "events.jsonl"), truncatedRaw, "utf-8");

    // Reopen and resume.
    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(runInfo.id);
    expect(handle.lastSeq).toBe(truncatedLog[truncatedLog.length - 1].seq);
    expect(handle.snapshot.completedResults).toHaveLength(1);

    const resumed = await executeWorkflow(def, { runsDir, resumeFrom: handle });
    expect(resumed.status).toBe("complete");
    expect(resumed.steps.map((s) => s.node)).toEqual(
      refSnapshot.completedResults.map((r) => r.node),
    );

    // The appended log must contain a run:resumed event and produce a
    // final snapshot equivalent to the reference run (ignoring tokens/status
    // — token ids may differ, and status comes out "complete" either way).
    const resumedLog = await readEventLog(join(runsDir, runInfo.id));
    const resumedEvent = resumedLog.find((e) => e.type === "run:resumed");
    expect(resumedEvent).toBeDefined();
    if (resumedEvent && resumedEvent.type === "run:resumed") {
      expect(resumedEvent.resumedAtSeq).toBe(handle.lastSeq);
    }

    const finalSnap = replay(resumedLog);
    expect(finalSnap.status).toBe("complete");
    expect(finalSnap.completedResults.map((r) => r.node)).toEqual(
      refSnapshot.completedResults.map((r) => r.node),
    );
  });

  it("replay of resumed log equals engine's final in-memory snapshot", async () => {
    const def = parseWorkflowFromString(LINEAR);
    const fresh = await executeWorkflow(def, { runsDir });

    // Truncate to only run:start (no steps done) → force a full re-seed path?
    // Resume requires tokens to exist in the snapshot; we'll instead truncate
    // after first step:complete so there's a real pending token.
    const fullLog = await readEventLog(join(runsDir, fresh.id));
    // Truncate just before the second `step:start`: the first step is
    // complete, its successor's token has been created (pending), but that
    // successor hasn't started executing yet.
    const runningIdxs = fullLog
      .map((e, i) => (e.type === "token:state" && e.to === "running" ? i : -1))
      .filter((i) => i >= 0);
    expect(runningIdxs.length).toBeGreaterThanOrEqual(2);
    const truncated = fullLog.slice(0, runningIdxs[1]);
    await writeFile(
      join(runsDir, fresh.id, "events.jsonl"),
      truncated.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(fresh.id);
    const engine = new WorkflowEngine(def, { runsDir, resumeFrom: handle });
    await engine.start();

    const live = engine.getSnapshot();
    const events = await readEventLog(join(runsDir, fresh.id));
    const replayed = replay(events);

    expect(replayed).toEqual(live);
  });

  it("new tokens after resume have strictly greater suffixes", async () => {
    const def = parseWorkflowFromString(LINEAR);
    const fresh = await executeWorkflow(def, { runsDir });

    const fullLog = await readEventLog(join(runsDir, fresh.id));
    // Truncate just before the second `step:start`: the first step is
    // complete, its successor's token has been created (pending), but that
    // successor hasn't started executing yet.
    const runningIdxs = fullLog
      .map((e, i) => (e.type === "token:state" && e.to === "running" ? i : -1))
      .filter((i) => i >= 0);
    expect(runningIdxs.length).toBeGreaterThanOrEqual(2);
    const truncated = fullLog.slice(0, runningIdxs[1]);
    await writeFile(
      join(runsDir, fresh.id, "events.jsonl"),
      truncated.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(fresh.id);
    const preMax = handle.tokenCounter;
    expect(preMax).toBeGreaterThan(0);

    await executeWorkflow(def, { runsDir, resumeFrom: handle });

    const finalLog = await readEventLog(join(runsDir, fresh.id));
    const postResumeCreates = finalLog.filter(
      (e) => e.type === "token:created" && e.seq > handle.lastSeq,
    );
    for (const evt of postResumeCreates) {
      if (evt.type !== "token:created") continue;
      const m = /^token-(\d+)$/.exec(evt.tokenId);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(preMax);
    }
  });

  it("rejects resume when workflow no longer contains a replayed nodeId", async () => {
    const def = parseWorkflowFromString(LINEAR);
    const fresh = await executeWorkflow(def, { runsDir });

    // Truncate mid-flight.
    const fullLog = await readEventLog(join(runsDir, fresh.id));
    // Truncate just before the second `step:start`: the first step is
    // complete, its successor's token has been created (pending), but that
    // successor hasn't started executing yet.
    const runningIdxs = fullLog
      .map((e, i) => (e.type === "token:state" && e.to === "running" ? i : -1))
      .filter((i) => i >= 0);
    expect(runningIdxs.length).toBeGreaterThanOrEqual(2);
    const truncated = fullLog.slice(0, runningIdxs[1]);
    await writeFile(
      join(runsDir, fresh.id, "events.jsonl"),
      truncated.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(fresh.id);
    const lastSeqBefore = handle.lastSeq;

    // Construct a "drifted" workflow that renames one of the nodes the log
    // still references.
    const DRIFTED = LINEAR.replace(/\bbuild\b/g, "compile");
    const driftedDef = parseWorkflowFromString(DRIFTED);

    await expect(
      executeWorkflow(driftedDef, { runsDir, resumeFrom: handle }),
    ).rejects.toBeInstanceOf(WorkflowChangedError);

    // No run:resumed event should have been appended.
    const after = await readEventLog(join(runsDir, fresh.id));
    expect(after.some((e) => e.type === "run:resumed")).toBe(false);
    expect(after[after.length - 1].seq).toBe(lastSeqBefore);
  });

  it("engine-finally releases the run lock on successful resume", async () => {
    const def = parseWorkflowFromString(LINEAR);
    const fresh = await executeWorkflow(def, { runsDir });

    // Truncate mid-flight so resume has real work to do (not just an empty
    // run that would short-circuit). Use the same shape as earlier tests.
    const fullLog = await readEventLog(join(runsDir, fresh.id));
    const runningIdxs = fullLog
      .map((e, i) => (e.type === "token:state" && e.to === "running" ? i : -1))
      .filter((i) => i >= 0);
    expect(runningIdxs.length).toBeGreaterThanOrEqual(2);
    const truncated = fullLog.slice(0, runningIdxs[1]);
    await writeFile(
      join(runsDir, fresh.id, "events.jsonl"),
      truncated.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const manager = createRunManager(runsDir);
    const handle = await manager.openExistingRun(fresh.id);

    const lockPath = lockPathFor(join(runsDir, fresh.id));
    // Lock is held between openExistingRun and the engine's finally.
    await expect(access(lockPath)).resolves.toBeUndefined();

    await executeWorkflow(def, { runsDir, resumeFrom: handle });

    // After executeWorkflow returns the engine's finally must have released
    // the lock, so the `.lock` directory is gone.
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replay folds token:reset back to pending with no edge/result", async () => {
    const def = parseWorkflowFromString(LINEAR);
    const fresh = await executeWorkflow(def, { runsDir });

    // Start from the full finished log, append a synthetic token:reset
    // event targeting the first completed token, and verify replay.
    const fullLog = await readEventLog(join(runsDir, fresh.id));
    const firstComplete = fullLog.find((e) => e.type === "token:state" && e.to === "complete");
    expect(firstComplete && firstComplete.type === "token:state").toBe(true);
    const tokenId = (firstComplete as Extract<EngineEvent, { type: "token:state" }>).tokenId;

    const maxSeq = fullLog[fullLog.length - 1].seq;
    const resetEvt: EngineEvent = {
      type: "token:reset",
      v: 1,
      tokenId,
      seq: maxSeq + 1,
      ts: new Date().toISOString(),
    };
    const appended = [...fullLog, resetEvt];
    const snap = replay(appended);
    const tok = snap.tokens.get(tokenId);
    expect(tok).toBeDefined();
    expect(tok!.state).toBe("pending");
    expect(tok!.edge).toBeUndefined();
    expect(tok!.result).toBeUndefined();
  });
});
