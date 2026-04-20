import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  type EngineEvent,
} from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("engine events.jsonl", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-runs-"));
  });

  afterEach(async () => {
    await rm(tempRunsDir, { recursive: true, force: true });
  });

  function readEventLog(runsDir: string, runId: string): EngineEvent[] {
    const raw = readFileSync(join(runsDir, runId, "events.jsonl"), "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as EngineEvent);
  }

  it("writes run:start as the first event of every run", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("run:start");
    if (events[0].type === "run:start") {
      expect(events[0].v).toBe(1);
      expect(events[0].workflowName).toBe(def.name);
      expect(events[0].sourceFile).toBe(def.sourceFile);
      expect(events[0].inputs).toBeTypeOf("object");
      expect(events[0].configResolved).toBeTypeOf("object");
    }
  });

  it("stamps every persisted event with a monotonic seq and ISO ts", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);

    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual(seqs.slice().sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[0]).toBe(1);
    for (const e of events) {
      expect(new Date(e.ts).toString()).not.toBe("Invalid Date");
    }
  });

  it("exposes stamped events through the onEvent handler", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const seen: EngineEvent[] = [];
    await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => seen.push(e),
    });
    expect(seen[0].type).toBe("run:start");
    expect(seen[0].seq).toBe(1);
    // step:output events are fire-and-forget via `void`; don't assume ordering
    // against persisted events, just that they carry a valid seq.
    for (const e of seen) {
      expect(typeof e.seq).toBe("number");
      expect(e.seq).toBeGreaterThan(0);
    }
  });

  it("emits token:created before token:state pending→running for each token", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);

    const bySeq = events.slice().sort((a, b) => a.seq - b.seq);
    const firstCreate = bySeq.findIndex((e) => e.type === "token:created");
    expect(firstCreate).toBeGreaterThan(0);
    // Every token:created has its pending→running transition strictly later.
    const creates = bySeq.filter((e) => e.type === "token:created");
    const transitions = bySeq.filter(
      (e) => e.type === "token:state" && e.from === "pending" && e.to === "running",
    );
    expect(transitions.length).toBeGreaterThanOrEqual(creates.length);
    for (const t of transitions) {
      if (t.type !== "token:state") continue;
      const match = creates.find(
        (c) => c.type === "token:created" && c.tokenId === t.tokenId,
      );
      expect(match).toBeDefined();
      expect(match!.seq).toBeLessThan(t.seq);
    }
  });

  it("emits global:update with keys and patch when a step sets globals", async () => {
    const source = `# T

# Flow

\`\`\`mermaid
flowchart TD
  a --> b
\`\`\`

# Steps

## a

\`\`\`bash
echo 'GLOBAL: {"k":"v","n":42}'
echo 'RESULT: {"edge":"next"}'
\`\`\`

## b

\`\`\`bash
echo ok
\`\`\``;
    const def = parseWorkflowFromString(source);
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);
    const update = events.find((e) => e.type === "global:update");
    expect(update).toBeDefined();
    if (update?.type === "global:update") {
      expect(update.keys.sort()).toEqual(["k", "n"]);
      expect(update.patch).toEqual({ k: "v", n: 42 });
    }

    // global:update must precede the step:complete for node `a` so replay
    // reconstructs the state in the same order.
    const updateIdx = events.findIndex((e) => e.type === "global:update");
    const completeIdx = events.findIndex(
      (e) => e.type === "step:complete" && e.result.node === "a",
    );
    expect(updateIdx).toBeLessThan(completeIdx);
  });

  it("does not emit global:update when the patch is empty", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);
    expect(events.find((e) => e.type === "global:update")).toBeUndefined();
  });

  it("writes sidecar stdout/stderr files and emits output:ref for each", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);

    const refs = events.filter((e) => e.type === "output:ref");
    // One per stream per step (setup, build, report) → 6 refs for linear fixture.
    expect(refs.length).toBe(runInfo.steps.length * 2);

    for (const r of refs) {
      if (r.type !== "output:ref") continue;
      // Path must actually exist on disk.
      const stats = readFileSync(r.path, "utf-8");
      expect(typeof stats).toBe("string");
      // File is keyed by the step:start seq, which precedes output:ref.
      const startEvent = events.find(
        (e) =>
          e.type === "step:start" &&
          e.tokenId === r.tokenId &&
          e.seq === r.stepSeq,
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.seq).toBeLessThan(r.seq);
    }
  });

  it("sidecar stdout file captures the child process transcript", async () => {
    const source = `# T

# Flow

\`\`\`mermaid
flowchart TD
  a --> b
\`\`\`

# Steps

## a

\`\`\`bash
echo "hello from a"
\`\`\`

## b

\`\`\`bash
echo ok
\`\`\``;
    const def = parseWorkflowFromString(source);
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const events = readEventLog(tempRunsDir, runInfo.id);

    const ref = events.find(
      (e) =>
        e.type === "output:ref" &&
        e.nodeId === "a" &&
        e.stream === "stdout",
    );
    expect(ref).toBeDefined();
    if (ref?.type === "output:ref") {
      const contents = readFileSync(ref.path, "utf-8");
      expect(contents).toContain("hello from a");
    }
  });

  it("creates events.jsonl in every run directory", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir: tempRunsDir });
    const files = readdirSync(join(tempRunsDir, runInfo.id));
    expect(files).toContain("events.jsonl");
  });
});
