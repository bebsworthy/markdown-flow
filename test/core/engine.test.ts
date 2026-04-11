import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
  type EngineEvent,
} from "../../src/core/index.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("WorkflowEngine", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-runs-"));
  });

  it("executes a linear workflow end-to-end", async () => {
    const source = readFileSync(join(FIXTURES, "linear.md"), "utf-8");
    const def = parseWorkflowFromString(source);
    const events: EngineEvent[] = [];

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => events.push(e),
    });

    expect(runInfo.status).toBe("complete");
    expect(runInfo.steps).toHaveLength(3);
    expect(runInfo.steps.map((s) => s.node)).toEqual([
      "setup",
      "build",
      "report",
    ]);

    // All steps should have exit code 0
    for (const step of runInfo.steps) {
      expect(step.exit_code).toBe(0);
    }

    // Check events
    const stepStarts = events.filter((e) => e.type === "step:start");
    expect(stepStarts).toHaveLength(3);

    const completeEvent = events.find((e) => e.type === "workflow:complete");
    expect(completeEvent).toBeDefined();
  });

  it("executes a parallel workflow with fan-out and fan-in", async () => {
    const source = readFileSync(join(FIXTURES, "parallel.md"), "utf-8");
    const def = parseWorkflowFromString(source);

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");
    // start + lint + test + typecheck + merge = 5
    expect(runInfo.steps).toHaveLength(5);

    // merge should be last
    const lastStep = runInfo.steps[runInfo.steps.length - 1];
    expect(lastStep.node).toBe("merge");
  });

  it("routes correctly based on exit code", async () => {
    const source = readFileSync(join(FIXTURES, "branch.md"), "utf-8");
    const def = parseWorkflowFromString(source);

    const runInfo = await executeWorkflow(def, {
      runsDir: tempRunsDir,
    });

    expect(runInfo.status).toBe("complete");
    // check exits 0 → pass → deploy
    expect(runInfo.steps).toHaveLength(2);
    expect(runInfo.steps[0].node).toBe("check");
    expect(runInfo.steps[1].node).toBe("deploy");
  });
});
